﻿using System;
using System.Collections.Specialized;
using System.Linq;
using System.Linq.Expressions;
using System.Net.Http;
using System.Reflection;
using System.Web;
using System.Web.Http.Filters;
using System.Collections.Generic;


namespace Breeze.WebApi {
  /// <summary>
  /// Used to parse and interpret OData like semantics on top of WebApi.
  /// </summary>
  /// <remarks>
  /// Remember to add it to the Filters for your configuration
  /// </remarks>
  public class EFActionFilter : ActionFilterAttribute {
    // For more information on ActionFilters see: 
    // http://blog.petegoo.com/index.php/2012/04/29/action-filter-to-support-odata-expands-as-ef-includes-in-asp-net-web-api/
    
    private static ExpressionTreeBuilder __builder = new ExpressionTreeBuilder();

    public override void OnActionExecuting(System.Web.Http.Controllers.HttpActionContext actionContext) {
      base.OnActionExecuting(actionContext);
    }
    /// <summary>
    /// Called when the action is executed.
    /// </summary>
    /// <param name="actionExecutedContext">The action executed context.</param>
    public override void OnActionExecuted(HttpActionExecutedContext actionExecutedContext) {
      if (actionExecutedContext.Response == null) {
        return;
      }

      NameValueCollection querystringParams =
        HttpUtility.ParseQueryString(actionExecutedContext.Request.RequestUri.Query);

      object responseObject;
      actionExecutedContext.Response.TryGetContentValue(out responseObject);
      var dQuery = ((dynamic)responseObject);
      if (dQuery.GetType().IsInstanceOfType(typeof(IQueryable))) {
        return;
      }

      var elementType = TypeFns.GetElementType(responseObject.GetType());

      string filterQueryString = querystringParams["$filter"];
      if (!string.IsNullOrWhiteSpace(filterQueryString)) {
        var func = BuildFilterFunc(filterQueryString, elementType);
        dQuery = func(dQuery as IQueryable);
      }

      string orderByQueryString = querystringParams["$orderby"];
      if (!string.IsNullOrWhiteSpace(orderByQueryString)) {
        var orderByClauses = orderByQueryString.Split(',').ToList();
        var isThenBy = false;
        orderByClauses.ForEach(obc => {
          var func = BuildOrderByFunc(isThenBy, elementType, obc);
          dQuery = func(dQuery as IQueryable);
          isThenBy = true;
        });
      }

      string skipQueryString = querystringParams["$skip"];
      if (!string.IsNullOrWhiteSpace(skipQueryString)) {
        var count = int.Parse(skipQueryString);
        var method = TypeFns.GetMethodByExample((IQueryable<String> q) => Queryable.Skip<String>(q, 999), elementType);
        var func = BuildIQueryableFunc(elementType, method, count);
        dQuery = func(dQuery as IQueryable);
      }

      string topQueryString = querystringParams["$top"];
      if (!string.IsNullOrWhiteSpace(topQueryString)) {
        var count = int.Parse(topQueryString);
        var method = TypeFns.GetMethodByExample((IQueryable<String> q) => Queryable.Take<String>(q, 999), elementType);
        var func = BuildIQueryableFunc(elementType, method, count);
        dQuery = func(dQuery as IQueryable);
      }

      string selectQueryString = querystringParams["$select"];
      if (!string.IsNullOrWhiteSpace(selectQueryString)) {
        var selectClauses = selectQueryString.Split(',').Select(sc => sc.Replace('/','.')).ToList();
        var func = BuildSelectFunc(elementType, selectClauses);
        dQuery = func(dQuery as IQueryable);
      }

      string expandsQueryString = querystringParams["$expand"];
      if (!string.IsNullOrWhiteSpace(expandsQueryString)) {
          expandsQueryString.Split(',').Select(s => s.Trim()).ToList().ForEach(expand => {
            dQuery = dQuery.Include(expand.Replace('/','.'));
          });
      }

      if (!string.IsNullOrWhiteSpace(selectQueryString)) {
        var formatter = ((dynamic)actionExecutedContext.Response.Content).Formatter;
        var oc = new System.Net.Http.ObjectContent(dQuery.GetType(), dQuery, formatter);
        actionExecutedContext.Response.Content = oc;
      } else {
        ((ObjectContent) actionExecutedContext.Response.Content).Value = dQuery;
      }
    }

    private static Func<IQueryable, IQueryable> BuildSelectFunc(Type elementType, List<String> selectClauses) {
      var propSigs = selectClauses.Select(sc => new PropertySignature(elementType, sc)).ToList();
      var dti = DynamicTypeInfo.FindOrCreate(propSigs.Select(ps => ps.Name), propSigs.Select(ps => ps.ReturnType));
      var lambdaExpr = CreateNewLambda(dti, propSigs);
      var method = TypeFns.GetMethodByExample((IQueryable<String> q) => q.Select(s => s.Length), elementType, dti.DynamicType);
      var func = BuildIQueryableFunc(elementType, method, lambdaExpr);
      return func;
    }

    private static LambdaExpression CreateNewLambda(DynamicTypeInfo dti, IEnumerable<PropertySignature> selectors) {
      var paramExpr = Expression.Parameter(selectors.First().InstanceType, "t");
      // cannot create a NewExpression on a dynamic type becasue of EF restrictions
      // so we always create a MemberInitExpression with bindings ( i.e. a new Foo() { a=1, b=2 } instead of new Foo(1,2);
      var newExpr = Expression.New(dti.DynamicEmptyConstructor);
      var propertyExprs = selectors.Select(s => s.BuildMemberExpression(paramExpr));
      var dynamicProperties = dti.DynamicType.GetProperties();
      var bindings = dynamicProperties.Zip(propertyExprs, (prop, expr) => Expression.Bind(prop, expr));
      var memberInitExpr = Expression.MemberInit(newExpr, bindings.Cast<MemberBinding>());
      var newLambda = Expression.Lambda(memberInitExpr, paramExpr);
      return newLambda;
    }

    private static Func<IQueryable, IQueryable> BuildFilterFunc(string filterQueryString, Type elementType) {
      var lambdaExpr = __builder.Parse(elementType, filterQueryString);
      var method = TypeFns.GetMethodByExample((IQueryable<String> q) => q.Where(s => true), elementType);
      var func = BuildIQueryableFunc(elementType, method, lambdaExpr);
      return func;
    }

    // TODO: Check if the ThenBy portion of this works
    private static Func<IQueryable, IQueryable> BuildOrderByFunc(bool isThenBy, Type elementType, string obc) {
      var parts = obc.Trim().Replace("  ", " ").Split(' ');
      var propertyPath = parts[0];
      bool isDesc = parts.Length > 1 && parts[1] == "desc";
      var paramExpr = Expression.Parameter(elementType, "o");
      Expression nextExpr = paramExpr;
      var propertyNames = propertyPath.Split('/').ToList();
      propertyNames.ForEach(pn => {
        var nextElementType = nextExpr.Type;
        var propertyInfo = nextElementType.GetProperty(pn);
        if (propertyInfo == null) {
          throw new Exception("Unable to locate property: " + pn + " on type: " + nextElementType.ToString());
        }
        nextExpr = Expression.MakeMemberAccess(nextExpr, propertyInfo);
      });
      var lambdaExpr = Expression.Lambda(nextExpr, paramExpr);
      
      var orderByMethod = GetOrderByMethod(isThenBy, isDesc, elementType, nextExpr.Type);

      var baseType = isThenBy ? typeof (IOrderedQueryable<>) : typeof (IQueryable<>);
      var func = BuildIQueryableFunc(elementType, orderByMethod, lambdaExpr, baseType);
      return func;
    }

    private static MethodInfo GetOrderByMethod(bool isThenBy, bool isDesc, Type elementType, Type nextExprType) {
      MethodInfo orderByMethod;
      if (isThenBy) {
        orderByMethod = isDesc
                          ? TypeFns.GetMethodByExample(
                            (IOrderedQueryable<String> q) => q.ThenByDescending(s => s.Length),
                            elementType, nextExprType)
                          : TypeFns.GetMethodByExample(
                            (IOrderedQueryable<String> q) => q.ThenBy(s => s.Length),
                            elementType, nextExprType);
      } else {
        orderByMethod = isDesc
                          ? TypeFns.GetMethodByExample(
                            (IQueryable<String> q) => q.OrderByDescending(s => s.Length),
                            elementType, nextExprType)
                          : TypeFns.GetMethodByExample(
                            (IQueryable<String> q) => q.OrderBy(s => s.Length),
                            elementType, nextExprType);
      }
      return orderByMethod;
    }

    private static Func<IQueryable, IQueryable> BuildIQueryableFunc<TArg>(Type instanceType, MethodInfo method, TArg parameter, Type queryableBaseType = null) {
      if (queryableBaseType == null) {
        queryableBaseType = typeof(IQueryable<>);
      }
      var paramExpr = Expression.Parameter(typeof(IQueryable));
      var queryableType = queryableBaseType.MakeGenericType(instanceType);
      var castParamExpr = Expression.Convert(paramExpr, queryableType);


      var callExpr = Expression.Call(method, castParamExpr, Expression.Constant(parameter));
      var castResultExpr = Expression.Convert(callExpr, typeof(IQueryable));
      var lambda = Expression.Lambda(castResultExpr, paramExpr);
      var func = (Func<IQueryable, IQueryable>)lambda.Compile();
      return func;
    }
  }
}


