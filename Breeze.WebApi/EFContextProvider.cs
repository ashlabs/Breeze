﻿using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Configuration;
using System.Data;
using System.Data.Entity;
using System.Data.Entity.Infrastructure;
using System.Data.Metadata.Edm;
using System.Data.Objects;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Xml;
using System.Xml.Linq;

using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using System.Text;
using System.Web;

namespace Breeze.WebApi {


  // T is either a subclass of DbContext or a subclass of ObjectContext
  public class EFContextProvider<T> where T : class, new() {

    // contextName is the connectionString name for an ObjectContext, may be null for a DbContext.
    public EFContextProvider(String contextName) {
      if (String.IsNullOrEmpty(contextName) && typeof (ObjectContext).IsAssignableFrom(typeof (T))) {
        throw new Exception("A contextName must be provided where 'T' is a subclass of ObjectContext.");
      }
      ContextName = contextName;
    }

    public String ContextName { get; private set; }
    public IKeyGenerator KeyGenerator { get; set; }

    public T Context {
      get {
        if (_context == null) {
          _context = new T();
        }
        return _context;
      }
    }

    public ObjectContext ObjectContext {
      get {
        if (typeof (ObjectContext).IsAssignableFrom(typeof (T))) {
          return (ObjectContext) (Object) Context;
        } else {
          return ((IObjectContextAdapter) Context).ObjectContext;
        }
      }
    }

    public string Metadata() {
      if (__jsonMetadata == null) {
        if (Context is DbContext) {
          __jsonMetadata = GetJsonMetadataFromDbContext((DbContext) (Object) Context);
        } else {
          __jsonMetadata = GetJsonMetadataFromObjectContext((ObjectContext) (Object) Context, ContextName);
        }
      }
      return __jsonMetadata;
    }

    public SaveResult SaveChanges(JObject saveBundle) {
      var dynSaveBundle = (dynamic) saveBundle;
      var entitiesArray = (JArray) dynSaveBundle.entities;
      var saveOptions = dynSaveBundle.saveOptions;
      var jsonSerializer = new JsonSerializer();
      var jObjects = entitiesArray.Select(jt => (dynamic) jt).ToList();

      var groups = jObjects.GroupBy(jo => (String) jo.entityAspect.entityTypeName).ToList();
      List<List<EntityInfo>> entityInfoGroups = groups.Select(g => {
        var entityType = LookupEntityType(g.Key);
        return g.Select(jo => (EntityInfo) CreateEntityInfo(jo, entityType, jsonSerializer)).ToList();
      }).ToList();
      var deletedEntities = ProcessSaves(entityInfoGroups);

      if (deletedEntities.Any()) {
        ProcessAllDeleted(deletedEntities);
      }
      ProcessAutogeneratedKeys();
      
      ObjectContext.SaveChanges(System.Data.Objects.SaveOptions.AcceptAllChangesAfterSave);
      var entities = entityInfoGroups.SelectMany(grp => grp.Select(entityInfo => entityInfo.Entity)).ToList();
      var keyMappings = UpdateGeneratedKeys();

      return new SaveResult() {Entities = entities, KeyMappings = keyMappings};
    }

    private void ProcessAutogeneratedKeys() {
      var tempKeys = _entitiesWithAutoGeneratedKeys.Where(
        entityInfo => entityInfo.AutoGeneratedKey.AutoGeneratedKeyType == AutoGeneratedKeyType.KeyGenerator)
        .Select(ei => new TempKeyInfo(ei))
        .ToList();
      if (tempKeys.Count == 0) return;
      if (this.KeyGenerator == null) {
        this.KeyGenerator = GetKeyGenerator();
      }
      this.KeyGenerator.UpdateKeys(tempKeys);
      tempKeys.ForEach(tki => {
        // Clever hack - next 3 lines cause all entities related to tki.Entity to have 
        // their relationships updated. So all related entities for each tki are updated.
        // Basically we set the entity to look like a preexisting entity by setting its
        // entityState to unchanged.  This is what fixes up the relations, then we set it back to added
        // Now when we update the pk - all fks will get changed as well.  Note that the fk change will only
        // occur during the save.
        var entry = GetObjectStateEntry(tki.Entity);
        entry.ChangeState(EntityState.Unchanged);
        entry.ChangeState(EntityState.Added);
        var val = ConvertValue(tki.RealValue, tki.Property.PropertyType);
        tki.Property.SetValue(tki.Entity, val, null);
      });
    }

    private IKeyGenerator GetKeyGenerator() {
      var generatorTypes = typeof (T).Assembly.GetTypes()
        .Concat(this.GetType().Assembly.GetTypes())
        .Where(t => typeof (IKeyGenerator).IsAssignableFrom(t) && !t.IsAbstract)
        .ToList();
      if (generatorTypes.Count == 0) {
        throw new Exception("Unable to locate a KeyGenerator implementation.");
      }
      var generatorType = generatorTypes.First();
      return (IKeyGenerator) Activator.CreateInstance(generatorType, ContextName);
    }

    private EntityInfo CreateEntityInfo(dynamic jo, Type entityType, JsonSerializer jsonSerializer) {
      var entityInfo = new EntityInfo();
      entityInfo.Entity = jsonSerializer.Deserialize(new JTokenReader(jo), entityType);
      entityInfo.EntityState = (EntityState) Enum.Parse(typeof (EntityState), (String) jo.entityAspect.entityState);
      entityInfo.OriginalValuesMap = jo.entityAspect.originalValuesMap;
      var autoGeneratedKey = jo.entityAspect.autoGeneratedKey;
      if (entityInfo.EntityState == EntityState.Added && autoGeneratedKey != null) {
        entityInfo.AutoGeneratedKey = new AutoGeneratedKey(entityInfo.Entity, autoGeneratedKey);
        _entitiesWithAutoGeneratedKeys.Add(entityInfo);
      }
      return entityInfo;
    }

    #region Save related methods

    private List<EntityInfo> ProcessSaves(IEnumerable<List<EntityInfo>> groupsByType) {

      var deletedEntities = new List<EntityInfo>();
      foreach (var group in groupsByType) {
        var entityType = group.First().Entity.GetType();
        var entitySetName = GetEntitySetName(ObjectContext, entityType);
        foreach (var entityInfo in group) {
          entityInfo.EntitySetName = entitySetName;
          ProcessEntity(entityInfo);

          if (entityInfo.EntityState == EntityState.Deleted) {
            deletedEntities.Add(entityInfo);
          }
        }
      }
      return deletedEntities;
    }

    private EntityInfo ProcessEntity(EntityInfo entityInfo) {
      ObjectStateEntry ose;
      if (entityInfo.EntityState == EntityState.Modified) {
        ose = HandleModified(entityInfo);
      } else if (entityInfo.EntityState == EntityState.Added) {
        ose = HandleAdded(entityInfo);
      } else if (entityInfo.EntityState == EntityState.Deleted) {
        // for 1st pass this does NOTHING 
        ose = HandleDeletedPart1(entityInfo);
      } else {
        // needed for many to many to get both ends into the objectContext
        ose = HandleUnchanged(entityInfo);
      }
      entityInfo.ObjectStateEntry = ose;
      return entityInfo;
    }

    private ObjectStateEntry HandleAdded(EntityInfo entityInfo) {
      var entry = AddObjectStateEntry(entityInfo);
      if (entityInfo.AutoGeneratedKey != null) {
        entityInfo.AutoGeneratedKey.TempValue = GetOsePropertyValue(entry, entityInfo.AutoGeneratedKey.PropertyName);
      }
      entry.ChangeState(EntityState.Added);
      return entry;
    }

    private ObjectStateEntry HandleModified(EntityInfo entityInfo) {
      var entry = AddObjectStateEntry(entityInfo);
      // EntityState will be changed to modified during the update from the OriginalValuesMap
      // Do NOT change this to EntityState.Modified because this will cause the entire record to update.
      entry.ChangeState(EntityState.Unchanged);

      // updating the original values is necessary under certain conditions when we change a foreign key field
      // because the before value is used to determine ordering.
      UpdateOriginalValues(entry, entityInfo);

      //foreach (var dep in GetModifiedComplexTypeProperties(entity, metadata)) {
      //  entry.SetModifiedProperty(dep.Name);
      //}
      
      if (entry.State != EntityState.Modified) {
        // _originalValusMap can be null if we mark entity.SetModified but don't actually change anything.
        entry.ChangeState(EntityState.Modified);
      }
      return entry;
    }

    private ObjectStateEntry HandleUnchanged(EntityInfo entityInfo) {
      var entry = AddObjectStateEntry(entityInfo);
      entry.ChangeState(EntityState.Unchanged);
      return entry;
    }

    private ObjectStateEntry HandleDeletedPart1(EntityInfo entityInfo) {
      return null;
    }

    private void ProcessAllDeleted(List<EntityInfo> deletedEntities) {
      deletedEntities.ForEach(entityInfo => {

        RestoreOriginal(entityInfo);
        var entry = GetOrAddObjectStateEntry(entityInfo);
        entry.ChangeState(EntityState.Deleted);
        entityInfo.ObjectStateEntry = entry;
      });
    }

    private EntityInfo RestoreOriginal(EntityInfo entityInfo) {
      // fk's can get cleared depending on the order in which deletions occur -
      // EF needs the original values of these fk's under certain circumstances - ( not sure entirely what these are). 
      // so we restore the original fk values right before we attach the entity 
      // shouldn't be any side effects because we delete it immediately after.
      // concurrency values also need to be restored in some cases. 
      // This method restores more than it actually needs to because we don't
      // have metadata easily avail here, but usually a deleted entity will
      // not have much in the way of OriginalValues.
      if (entityInfo.OriginalValuesMap == null || entityInfo.OriginalValuesMap.Keys.Count == 0) {
        return entityInfo;
      }
      var entity = entityInfo.Entity;
      entityInfo.OriginalValuesMap.ToList().ForEach(kvp => {
        var value = ((JValue) kvp.Value).Value;
        SetPropertyValue(entity, kvp.Key, value);
      });

      return entityInfo;
    }

    private static void UpdateOriginalValues(ObjectStateEntry entry, EntityInfo entityInfo) {
      var originalValuesMap = entityInfo.OriginalValuesMap;
      if (originalValuesMap == null) return;

      var originalValuesRecord = entry.GetUpdatableOriginalValues();
      originalValuesMap.ToList().ForEach(kvp => {

        var propertyName = kvp.Key;
        var originalValue = ((JValue) kvp.Value).Value;
        
        
        try {
          entry.SetModifiedProperty(propertyName);
          // only really need to perform updating original values on key properties
          // and a complex object cannot be a key.
          // if (!(originalValue is IComplexObject)) {
          var ordinal = originalValuesRecord.GetOrdinal(propertyName);
          var fieldType = originalValuesRecord.GetFieldType(ordinal);
          var originalValueConverted = ConvertValue(originalValue, fieldType);
          
          if (originalValueConverted == null) {
            // bug - hack because of bug in EF - see 
            // http://social.msdn.microsoft.com/Forums/nl/adodotnetentityframework/thread/cba1c425-bf82-4182-8dfb-f8da0572e5da
            var temp = entry.CurrentValues[ordinal];
            entry.CurrentValues.SetDBNull(ordinal);
            entry.ApplyOriginalValues(entry.Entity);
            entry.CurrentValues.SetValue(ordinal, temp);
          } else {
            originalValuesRecord.SetValue(ordinal, originalValueConverted);
          }
        } catch (Exception e) {
          // this can happen for "custom" data entity properties.
        }
      });

    }

    private List<KeyMapping> UpdateGeneratedKeys() {
      var keyMappings = _entitiesWithAutoGeneratedKeys.Select(entityInfo => {
        var autoGeneratedKey = entityInfo.AutoGeneratedKey;
        if (autoGeneratedKey.AutoGeneratedKeyType == AutoGeneratedKeyType.Identity) {
          autoGeneratedKey.RealValue = GetOsePropertyValue(entityInfo.ObjectStateEntry, autoGeneratedKey.PropertyName);
        }
        return new KeyMapping() {
                                  EntityTypeName = entityInfo.Entity.GetType().FullName,
                                  TempValue = autoGeneratedKey.TempValue,
                                  RealValue = autoGeneratedKey.RealValue
                                };
      });
      return keyMappings.ToList();
    }

    private Object GetOsePropertyValue(ObjectStateEntry ose, String propertyName) {
      var currentValues = ose.CurrentValues;
      var ix = currentValues.GetOrdinal(propertyName);
      return currentValues[ix];
    }

    private void SetOsePropertyValue(ObjectStateEntry ose, String propertyName, Object value) {
      var currentValues = ose.CurrentValues;
      var ix = currentValues.GetOrdinal(propertyName);
      currentValues.SetValue(ix, value);
    }

    private void SetPropertyValue(Object entity, String propertyName, Object value) {
      var propInfo = entity.GetType().GetProperty(propertyName,
                                                  BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
      if (propInfo.CanWrite) {
        var val = ConvertValue(value, propInfo.PropertyType);
        propInfo.SetValue(entity, val, null);
      } else {
        throw new Exception(String.Format("Unable to write to property '{0}' on type: '{1}'", propertyName,
                                          entity.GetType()));
      }
    }

    private static Object ConvertValue(Object val, Type toType) {
      Object result;
      // TODO: handle nullables
      if (val == null) return val;
      if (toType == val.GetType()) return val;
      
      if (typeof (IConvertible).IsAssignableFrom(toType)) {
        result = Convert.ChangeType(val, toType, System.Threading.Thread.CurrentThread.CurrentCulture);
      } else {
        // Guids fail above - try this
        TypeConverter typeConverter = TypeDescriptor.GetConverter(toType);
        result = typeConverter.ConvertFrom(val);
      }
      return result;
    }
  

    private ObjectStateEntry GetOrAddObjectStateEntry(EntityInfo entityInfo) {
      ObjectStateEntry entry;
      if (ObjectContext.ObjectStateManager.TryGetObjectStateEntry(entityInfo.Entity, out entry)) return entry;

      return AddObjectStateEntry(entityInfo);
    }

    private ObjectStateEntry AddObjectStateEntry( EntityInfo entityInfo) {
      ObjectContext.AddObject(entityInfo.EntitySetName, entityInfo.Entity);
      // Attach has lots of side effect - add has far fewer.
      return GetObjectStateEntry(entityInfo);
    }

    private ObjectStateEntry AttachObjectStateEntry( EntityInfo entityInfo) {
      ObjectContext.AttachTo(entityInfo.EntitySetName, entityInfo.Entity);
      // Attach has lots of side effect - add has far fewer.
      return GetObjectStateEntry(entityInfo);
    }

    private ObjectStateEntry GetObjectStateEntry( EntityInfo entityInfo) {
      return GetObjectStateEntry(entityInfo.Entity);
    }

    private ObjectStateEntry GetObjectStateEntry(Object entity) {
      ObjectStateEntry entry;
      if (!ObjectContext.ObjectStateManager.TryGetObjectStateEntry(entity, out entry)) {
        throw new Exception("unable to add to context: " + entity);
      }
      return entry;
    }
    

    #endregion

    #region Metadata methods

    protected string GetJsonMetadataFromObjectContext(ObjectContext objectContext, string connectionName) {
      var xmlDoc = GetCsdlFromObjectContext(objectContext, connectionName);
      var jsonText = CsdlToJson(xmlDoc);

      /* Original version
      var jsonText = JsonConvert.SerializeXmlNode(doc);
      */
      return jsonText;
    }

    protected string GetJsonMetadataFromDbContext(DbContext dbContext) {
      var xDoc = GetCsdlFromDbContext(dbContext);
      var jsonText = CsdlToJson(xDoc);

      /* Original version
      var jsonText = JsonConvert.SerializeXmlNode(doc);
      */
      return jsonText;
    }

    protected XDocument GetCsdlFromObjectContext(ObjectContext objectContext, String connectionName) {
      var ocType = objectContext.GetType();
      var ocAssembly = ocType.Assembly;
      var ocNamespace = ocType.Namespace;
      var conn = GetConnectionString(connectionName);
      if (!conn.StartsWith(MetadataPrefix)) {
        throw new Exception("This connection string does not starts with:" + MetadataPrefix);
      }

      var csdlResource = conn.Split('|', ';', '=')
        .FirstOrDefault(s => {
          s = s.Trim();
          return s.StartsWith(ResourcePrefix) && s.EndsWith(".csdl");
        });
      if (csdlResource == null) {
        throw new Exception("Unable to locate a 'csdl' resource within this connection:" + conn);
      }

      var parts = csdlResource.Split('/', '.');
      var normalizedResourceName = String.Join(".", parts.Skip(parts.Length - 2));
      var manifestResourceName = ocAssembly.GetManifestResourceNames()
        .FirstOrDefault(n => n.EndsWith(normalizedResourceName));
      if (manifestResourceName == null) {
        throw new Exception("Unable to locate an embedded resource that ends with: " + normalizedResourceName);
      }
      XDocument xdoc;
      using (var mmxStream = ocAssembly.GetManifestResourceStream(manifestResourceName)) {
        xdoc = XDocument.Load(mmxStream);
      }
      // This is needed because the raw edmx has a different namespace than the CLR.
      xdoc.Root.SetAttributeValue("ClrNamespace", ocNamespace);
      
      return xdoc;
    }
  
    protected static XDocument GetCsdlFromDbContext(DbContext dbContext) {

      XElement xele;

      using (var swriter = new StringWriter()) {
        using (var xwriter = new XmlTextWriter(swriter)) {
          EdmxWriter.WriteEdmx(dbContext, xwriter);
          xele = XElement.Parse(swriter.ToString());
        }
      }

      var ns = xele.Name.Namespace;
      var conceptualModel = xele.Descendants(ns + "ConceptualModels").First();
      var xDoc = XDocument.Load(conceptualModel.CreateReader());
      return xDoc;
    }

    private String CsdlToJson(XDocument xDoc) {

      var sw = new StringWriter();
      using (var jsonWriter = new JsonPropertyFixupWriter(sw)) {
        // jsonWriter.Formatting = Newtonsoft.Json.Formatting.Indented;
        var jsonSerializer = new JsonSerializer();
        var converter = new XmlNodeConverter();
        // May need to put this back.
        // converter.OmitRootObject = true;
        // doesn't seem to do anything.
        // converter.WriteArrayAttribute = true;
        jsonSerializer.Converters.Add(converter);
        jsonSerializer.Serialize(jsonWriter, xDoc);
      }

      var jsonText = sw.ToString();
      return jsonText;
    }

    protected String GetConnectionString(String connectionName) {
      var item = ConfigurationManager.ConnectionStrings[connectionName];
      return item.ConnectionString;
    }

    #endregion

    private String GetEntitySetName(ObjectContext context, Type entityType) {
      var typeName = entityType.Name;
      var container = context.MetadataWorkspace.GetEntityContainer(context.DefaultContainerName, DataSpace.CSpace);
      var entitySetName = container.BaseEntitySets
        .Where(es => es.ElementType.Name == typeName)
        .Select(es => es.Name)
        .First();
      return entitySetName;
    }

    private Type LookupEntityType(String entityTypeName) {
      var delims = new string[] { ":#" };
      var parts = entityTypeName.Split(delims, StringSplitOptions.None);
      var shortName = parts[0];
      var ns = parts[1];
      var assembly = Context.GetType().Assembly;
      var type = assembly.GetType(ns + "." + shortName);
      return type;
    }


    private const string ResourcePrefix = @"res://";
    private const string MetadataPrefix = "metadata=";
    private static string __jsonMetadata;
    private List<EntityInfo> _entitiesWithAutoGeneratedKeys = new List<EntityInfo>();
    private T _context;
  }

  public interface IKeyGenerator {
    void UpdateKeys(List<TempKeyInfo> keys);
  }

  // instances of this sent to KeyGenerator
  public class TempKeyInfo {
    public TempKeyInfo(EntityInfo entityInfo) {
      _entityInfo = entityInfo;
    }
    public Object Entity {
      get { return _entityInfo.Entity; }
    }
    public Object TempValue {
      get { return _entityInfo.AutoGeneratedKey.TempValue; }
    }
    public Object RealValue {
      get { return _entityInfo.AutoGeneratedKey.RealValue; }
      set { _entityInfo.AutoGeneratedKey.RealValue = value; }
    }

    public PropertyInfo Property {
      get { return _entityInfo.AutoGeneratedKey.Property; }
    }

    private EntityInfo _entityInfo;

  }

  public class EntityInfo {
    public EntityInfo() {
    }

    public Object Entity;
    public EntityState EntityState;
    public String EntitySetName;
    public IDictionary<String, JToken> OriginalValuesMap;
    public AutoGeneratedKey AutoGeneratedKey;
    public ObjectStateEntry ObjectStateEntry;
  }

  public enum AutoGeneratedKeyType {
    None,
    Identity,
    KeyGenerator
  }

  public class AutoGeneratedKey {
    public AutoGeneratedKey(Object entity, dynamic autoGeneratedKey) {
      Entity = entity;
      PropertyName = autoGeneratedKey.propertyName;
      AutoGeneratedKeyType = (AutoGeneratedKeyType)Enum.Parse(typeof(AutoGeneratedKeyType), (String)autoGeneratedKey.autoGeneratedKeyType);
      // TempValue and RealValue will be set later. - TempValue during Add, RealValue after save completes.
    }

    public Object Entity;
    public AutoGeneratedKeyType AutoGeneratedKeyType;
    public String PropertyName;
    public PropertyInfo Property {
      get {
        if (_property == null) {
          _property = Entity.GetType().GetProperty(PropertyName,
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
        }
        return _property;
      }
    }
    public Object TempValue;
    public Object RealValue;
    private PropertyInfo _property;
  }

 

  // Types returned to javascript as Json.
  public class SaveResult {
    public List<Object> Entities;
    public List<KeyMapping> KeyMappings;
    public String Error;
  }

  public class KeyMapping {
    public String EntityTypeName;
    public Object TempValue;
    public Object RealValue;
  }

  public class JsonPropertyFixupWriter : JsonTextWriter {
    public JsonPropertyFixupWriter(TextWriter textWriter)
      : base(textWriter) {
      _isName = false;
    }

    public override void WritePropertyName(string name) {
      if (name.StartsWith("@")) {
        name = name.Substring(1);
      }
      name = ToCamelCase(name);
      _isName = name == "type";
      base.WritePropertyName(name);
    }

    public override void WriteValue(string value) {
      if (_isName) {
        base.WriteValue("Edm." + value);
      } else {
        base.WriteValue(value);
      }
    }

    private static string ToCamelCase(string s) {
      if (string.IsNullOrEmpty(s) || !char.IsUpper(s[0]))
        return s;
      string str = char.ToLower(s[0], CultureInfo.InvariantCulture).ToString((IFormatProvider)CultureInfo.InvariantCulture);
      if (s.Length > 1)
        str = str + s.Substring(1);
      return str;
    }

    private bool _isName;

  }
 
}