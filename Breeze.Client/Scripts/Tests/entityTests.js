require.config({ baseUrl: "Scripts/IBlade" });

define(["testFns"], function (testFns) {
    var root = testFns.root;
    var core = root.core;
    var entityModel = root.entityModel;
    var Enum = core.Enum;

    var MetadataStore = entityModel.MetadataStore;
    var EntityManager = entityModel.EntityManager;
    var EntityQuery = entityModel.EntityQuery;
    var EntityKey = entityModel.EntityKey;

    var metadataStore = new MetadataStore();
    var newEm = function () { return new EntityManager({ serviceName: testFns.ServiceName, metadataStore: metadataStore }); };

    module("entity", {
        setup: function () {
            // core.config.typeRegistry = { };
            if (!metadataStore.isEmpty()) return;
            var em = newEm();
            stop();
            em.fetchMetadata(function () {
                var isEmptyMetadata = metadataStore.isEmpty();
                ok(!isEmptyMetadata);
                start();
            });
            
        },
        teardown: function () {

        }
    });

    test("custom Customer type with createEntity", function() {
        var em = new EntityManager({ serviceName: testFns.ServiceName, metadataStore: new MetadataStore() });
        
        var Customer = function() {
            this.miscData = "asdf";
        };
        Customer.prototype.getNameLength = function() {
            return (this.getProperty("CompanyName") || "").length;
        };

        em.metadataStore.registerEntityTypeCtor("Customer", Customer);
        stop();
        em.fetchMetadata().then(function() {
            var custType = em.metadataStore.getEntityType("Customer");
            var cust1 = custType.createEntity();
            ok(cust1.entityType === custType, "entityType should be Customer");
            ok(cust1.entityAspect.entityState.isDetached(), "should be detached");
            em.attachEntity(cust1);
            ok(cust1.entityType === custType, "entityType should be Customer");
            ok(cust1.entityAspect.entityState.isUnchanged(), "should be unchanged");
            ok(cust1.getProperty("miscData") === "asdf");
            cust1.setProperty("CompanyName", "testxxx");
            ok(cust1.getNameLength() === 7, "getNameLength should be 7");
            start();
        }).fail(testFns.handleFail);
    });
    
    test("custom Customer type with new", function() {
        var em = new EntityManager({ serviceName: testFns.ServiceName, metadataStore: new MetadataStore() });
        
        var Customer = function() {
            this.miscData = "asdf";
        };
        Customer.prototype.getNameLength = function() {
            return (this.getProperty("CompanyName") || "").length;
        };

        em.metadataStore.registerEntityTypeCtor("Customer", Customer);
        stop();
        em.fetchMetadata().then(function() {
            var custType = em.metadataStore.getEntityType("Customer");
            var cust1 = new Customer();
             // this works because the fetchMetadataStore hooked up the entityType on the registered ctor.
            ok(cust1.entityType === custType, "entityType should be undefined");
            ok(cust1.entityAspect === undefined, "entityAspect should be undefined");
            em.attachEntity(cust1);
            ok(cust1.entityType === custType, "entityType should be Customer");
            ok(cust1.entityAspect.entityState.isUnchanged(), "should be unchanged");
            ok(cust1.getProperty("miscData") === "asdf");
            cust1.setProperty("CompanyName", "testxxx");
            ok(cust1.getNameLength() === 7, "getNameLength should be 7");
            start();
        }).fail(testFns.handleFail);
    });

    test("custom Customer type with new - v2", function() {
        var em = new EntityManager({ serviceName: testFns.ServiceName, metadataStore: new MetadataStore() });
        
        var Customer = function() {
            this.miscData = "asdf";
        };
        Customer.prototype.getNameLength = function() {
            return (this.getProperty("CompanyName") || "").length;
        };

        stop();
        em.fetchMetadata().then(function() {
            em.metadataStore.registerEntityTypeCtor("Customer", Customer);
            var custType = em.metadataStore.getEntityType("Customer");
            var cust1 = new Customer();
             // this works because the fetchMetadataStore hooked up the entityType on the registered ctor.
            ok(cust1.entityType === custType, "entityType should be undefined");
            ok(cust1.entityAspect === undefined, "entityAspect should be undefined");
            em.attachEntity(cust1);
            ok(cust1.entityType === custType, "entityType should be Customer");
            ok(cust1.entityAspect.entityState.isUnchanged(), "should be unchanged");
            ok(cust1.getProperty("miscData") === "asdf");
            cust1.setProperty("CompanyName", "testxxx");
            ok(cust1.getNameLength() === 7, "getNameLength should be 7");
            start();
        }).fail(testFns.handleFail);
    });
    
    test("entityState", function () {
        stop();
        runQuery(newEm(), function (customers) {
            var c = customers[0];
            testEntityState(c);
            start();
        });
    });

    test("knockout chaining on write", function() {
        if (!testFns.DEBUG_KO) {
            ok("Test skipped - Not running under Knockout");
            return;
        };
        var em1 = newEm();
        var custType = em1.metadataStore.getEntityType("Customer");
        var cust1 = custType.createEntity();
        var sameCust = cust1.CompanyName("First");
        ok(sameCust === cust1, "ko setters need to chain");
        var val1 = cust1.CompanyName();
        ok(val1 === "First");
        cust1.CompanyName("Second").ContactTitle("Foo").ContactName("Bar");
        ok(cust1.ContactTitle() == "Foo");
        ok(cust1.ContactName() == "Bar");
    });
   


    test("entityType.getProperty nested", function() {
        var odType = metadataStore.getEntityType("OrderDetail");
        var orderType = metadataStore.getEntityType("Order");
        
        var customerProp = odType.getProperty("Order.Customer");
        var customerProp2 = orderType.getProperty("Customer");
        ok(customerProp, "should not be null");
        ok(customerProp == customerProp2, "should be the same prop");
        var prop1 = odType.getProperty("Order.Customer.CompanyName");
        var prop2 = orderType.getProperty("Customer.CompanyName");
        ok(prop1, "should not be null");
        ok(prop1 == prop2, "should be the same prop");
    });

    test("entityCtor materialization with js class", function () {
        // use a different metadata store for this em - so we don't polute other tests
        var em1 = new EntityManager({ serviceName: testFns.ServiceName, metadataStore: new MetadataStore() });
        var Customer = function () {
            this.miscData = "asdf";
        };


        em1.metadataStore.registerEntityTypeCtor("Customer", Customer);
        stop();
        runQuery(em1, function (customers) {
            var c = customers[0];
            ok(c.getProperty("miscData") === "asdf", "miscData property should contain 'asdf'");
            testEntityState(c);
            start();
        });
    });
    
    test("unmapped import export", function() {

        // use a different metadata store for this em - so we don't polute other tests
        var em1 = new EntityManager({ serviceName: testFns.ServiceName, metadataStore: new MetadataStore() });
        var Customer = function() {
            this.miscData = "asdf";
        };

        em1.metadataStore.registerEntityTypeCtor("Customer", Customer);
        stop();
        em1.fetchMetadata().then(function() {
            var custType = em1.metadataStore.getEntityType("Customer");
            var cust = custType.createEntity();
            em1.addEntity(cust);
            cust.setProperty("CompanyName", "foo2");
            cust.setProperty("miscData", "zzz");
            var bundle = em1.export();
            var em2 = new EntityManager({ serviceName: testFns.ServiceName, metadataStore: em1.metadataStore });
            em2.import(bundle);
            var entities = em2.getEntities();
            ok(entities.length === 1);
            var sameCust = entities[0];
            var cname = sameCust.getProperty("CompanyName");
            ok(cname === "foo2","CompanyName should === 'foo2'");
            var miscData = sameCust.getProperty("miscData");
            ok(miscData === "zzz","miscData should === 'zzz'");
            start();
        }).fail(testFns.handleFail);
    });

    test("generate ids", function () {
        var orderType = metadataStore.getEntityType("Order");
        var em = newEm();
        var count = 10;
        for (var i = 0; i < count; i++) {
            var ent = orderType.createEntity();
            em.addEntity(ent);
        }
        var tempKeys = em.keyGenerator.getTempKeys();
        ok(tempKeys.length == count);
        tempKeys.forEach(function (k) {
            ok(em.keyGenerator.isTempKey(k), "This should be a temp key: " + k.toString());
        });
    });

    test("createEntity and check default values", function () {
        var et = metadataStore.getEntityType("Customer");
        checkDefaultValues(et);
        var entityTypes = metadataStore.getEntityTypes();
        entityTypes.forEach(function (et) {
            checkDefaultValues(et);
        });
    });

    test("propertyChanged", function () {
        var em = newEm();
        var orderType = metadataStore.getEntityType("Order");
        ok(orderType);
        var orderDetailType = metadataStore.getEntityType("OrderDetail");
        ok(orderDetailType);
        var order = orderType.createEntity();
        var lastProperty, lastOldValue, lastNewValue;
        order.entityAspect.propertyChanged.subscribe(function (args) {
            ok(args.entity === order,"args.entity === order");
            lastProperty = args.propertyName;
            lastOldValue = args.oldValue;
            lastNewValue = args.newValue;
        });
        var order2 = orderType.createEntity();

        order.setProperty("EmployeeID", 1);
        order2.setProperty("EmployeeID", 999); // should not raise event
        ok(lastProperty === "EmployeeID");
        ok(lastNewValue === 1);
        order.setProperty("Freight", 123.34);
        ok(lastProperty === "Freight");
        ok(lastNewValue === 123.34);
        order.setProperty("ShippedDate", new Date(2000, 1, 1));
        ok(lastProperty === "ShippedDate");
        ok(lastNewValue.toDateString() == new Date(2000, 1, 1).toDateString());

        order.setProperty("EmployeeID", 2);
        ok(lastProperty === "EmployeeID");
        ok(lastNewValue === 2);
        ok(lastOldValue === 1);
    });

    test("propertyChanged unsubscribe", function () {
        var em = newEm();
        var orderType = metadataStore.getEntityType("Order");
        ok(orderType);
        var order = orderType.createEntity();
        var lastProperty, lastOldValue, lastNewValue;
        var key = order.entityAspect.propertyChanged.subscribe(function (args) {
            lastProperty = args.propertyName;
            lastOldValue = args.oldValue;
            lastNewValue = args.newValue;
        });
        order.setProperty("EmployeeID", 1);
        ok(lastProperty === "EmployeeID");
        ok(lastNewValue === 1);
        order.entityAspect.propertyChanged.unsubscribe(key);
        order.setProperty("EmployeeID", 999);
        ok(lastProperty === "EmployeeID");
        ok(lastNewValue === 1);
    });

    test("propertyChanged on query", function () {
        var em = newEm();
        var empType = metadataStore.getEntityType("Employee");
        ok(empType);
        var emp = empType.createEntity();
        emp.setProperty("EmployeeID", 1);
        var changes = [];
        emp.entityAspect.propertyChanged.subscribe(function (args) {
            changes.push(args);
        });
        em.attachEntity(emp);
        // now fetch
        var q = EntityQuery.fromEntities(emp);
        var uri = q._toUri();
        stop();
        em.executeQuery(q, function(data) {
            ok(changes.length === 1, "query merges should only fire a single property change");
            ok(changes[0].propertyName === null, "propertyName should be null on a query merge");
            start();
        }).fail(testFns.handleFail);
    });

    test("delete entity - check children", function () {
        var em = newEm();
        var order = createOrderAndDetails(em);
        var details = order.getProperty("OrderDetails");
        var copyDetails = details.slice(0);
        ok(details.length > 0, "order should have details");
        order.entityAspect.setDeleted();
        ok(order.entityAspect.entityState.isDeleted(), "order should be deleted");

        ok(details.length === 0, "order should now have no details");

        copyDetails.forEach(function (od) {
            ok(od.getProperty("Order") === null, "orderDetail.order should not be set");
            var defaultOrderId = od.entityType.getProperty("OrderID").defaultValue;
            ok(od.getProperty("OrderID") === defaultOrderId, "orderDetail.orderId should not be set");
            ok(od.entityAspect.entityState.isModified(), "orderDetail should be 'modified");
        });
    });

    test("delete entity - check parent", function () {
        var em = newEm();
        var order = createOrderAndDetails(em);
        var details = order.getProperty("OrderDetails");
        var od = details[0];
        ok(details.indexOf(od) !== -1);
        var copyDetails = details.slice(0);
        ok(details.length > 0, "order should have details");
        od.entityAspect.setDeleted();
        ok(od.entityAspect.entityState.isDeleted(), "orderDetail should be deleted");

        ok(details.length === copyDetails.length - 1, "order should now have 1 less detail");
        ok(details.indexOf(od) === -1);

        ok(od.getProperty("Order") === null, "orderDetail.order should not be set");
        var defaultOrderId = od.entityType.getProperty("OrderID").defaultValue;
        // we deliberately leave the orderID alone after a delete - we are deleting the entity and do not want a 'mod' to cloud the issue
        // ( but we do 'detach' the Order itself.)
        ok(od.getProperty("OrderID") === order.getProperty("OrderID"), "orderDetail.orderId should not change as a result of being deleted");
    });

    test("detach entity - check children", function () {
        var em = newEm();
        var order = createOrderAndDetails(em);
        var details = order.getProperty("OrderDetails");
        var copyDetails = details.slice(0);
        ok(details.length > 0, "order should have details");
        em.detachEntity(order);
        ok(order.entityAspect.entityState.isDetached(), "order should be detached");

        ok(details.length === 0, "order should now have no details");

        copyDetails.forEach(function (od) {
            ok(od.getProperty("Order") === null, "orderDetail.order should not be set");
            var defaultOrderId = od.entityType.getProperty("OrderID").defaultValue;
            ok(od.getProperty("OrderID") === defaultOrderId, "orderDetail.orderId should not be set");
            ok(od.entityAspect.entityState.isModified(), "orderDetail should be 'modified");
        });
    });

   test("hasChanges", function() {
        var em = newEm();
        var metadataStore = em.metadataStore;
        var orderType = metadataStore.getEntityType("Order");
        var orderDetailType = metadataStore.getEntityType("OrderDetail");
        var order1 = createOrderAndDetails(em, false);
        var order2 = createOrderAndDetails(em, false);
        
        var valid = em.hasChanges();
        ok(valid, "should have some changes");
        valid = em.hasChanges(orderType);
        ok(valid, "should have changes for Orders");
        valid = em.hasChanges([orderType, orderDetailType]);
        ok(valid, "should have changes for Orders or OrderDetails");
        em.getChanges(orderType).forEach(function(e) {
            e.entityAspect.acceptChanges();
        });
        valid = !em.hasChanges(orderType);
        ok(valid, "should not have changes for Orders");
        valid = em.hasChanges(orderDetailType);
        ok(valid, "should still have changes for OrderDetails");
        em.getChanges(orderDetailType).forEach(function(e) {
            e.entityAspect.acceptChanges();
        });
        valid = !em.hasChanges([orderType, orderDetailType]);
        ok(valid, "should no longer have changes for Orders or OrderDetails");
        valid = !em.hasChanges();
        ok(valid, "should no longer have any changes");
    });
    
    test("rejectChanges", function() {
        var em = newEm();
        var orderType = metadataStore.getEntityType("Order");
        var orderDetailType = metadataStore.getEntityType("OrderDetail");
        var order1 = createOrderAndDetails(em, false);
        var order2 = createOrderAndDetails(em, false);
        
        var valid = em.hasChanges();
        ok(valid, "should have some changes");
        valid = em.hasChanges(orderType);
        ok(valid, "should have changes for Orders");
        valid = em.hasChanges([orderType, orderDetailType]);
        ok(valid, "should have changes for Orders or OrderDetails");
        em.getChanges(orderType).forEach(function(e) {
            e.entityAspect.acceptChanges();
            e.setProperty("Freight", 100);
            ok(e.entityAspect.entityState.isModified(), "should be modified");
        });
        var rejects = em.rejectChanges();
        ok(rejects.length > 0, "should have rejected some");
        var hasChanges = em.hasChanges(orderType);
        ok(!hasChanges, "should not have changes for Orders");
        hasChanges = em.hasChanges(orderDetailType);
        ok(!hasChanges, "should not have changes for OrderDetails");

        valid = !em.hasChanges();
        ok(valid, "should no longer have any changes");
    });
   

    function createOrderAndDetails(em, shouldAttachUnchanged) {
        if (shouldAttachUnchanged === undefined) shouldAttachUnchanged = true;
        var metadataStore = em.metadataStore;
        var orderType = metadataStore.getEntityType("Order");
        var orderDetailType = metadataStore.getEntityType("OrderDetail");
        var order = orderType.createEntity();
        ok(order.entityAspect.entityState.isDetached(), "order should be 'detached");
        for (var i = 0; i < 3; i++) {
            var od = orderDetailType.createEntity();
            od.setProperty("ProductID", i + 1); // part of pk
            order.getProperty("OrderDetails").push(od);
            ok(od.entityAspect.entityState.isDetached(), "orderDetail should be 'detached");
        }
        var orderId;
        if (shouldAttachUnchanged) {
            em.attachEntity(order);
            orderId = order.getProperty("OrderID");
            order.getProperty("OrderDetails").forEach(function (od) {
                ok(od.getProperty("Order") === order, "orderDetail.order not set");
                ok(od.getProperty("OrderID") === orderId, "orderDetail.orderId not set");
                ok(od.entityAspect.entityState.isUnchanged(), "orderDetail should be 'unchanged");
            });
        } else {
            em.addEntity(order);
            orderId = order.getProperty("OrderID");
            order.getProperty("OrderDetails").forEach(function (od) {
                ok(od.getProperty("Order") === order, "orderDetail.order not set");
                ok(od.getProperty("OrderID") === orderId, "orderDetail.orderId not set");
                ok(od.entityAspect.entityState.isAdded(), "orderDetail should be 'added");
            });
        }
        return order;
    }


    function runQuery(em, callback) {

        var query = new EntityQuery()
            .from("Customers")
            .where("CompanyName", "startsWith", "C")
            .orderBy("CompanyName");

        em.executeQuery(query, function (data) {
            callback(data.results);
        }).fail(testFns.handleFail);
    }

    function testEntityState(c) {
        ok(c.getProperty("CompanyName"), 'should have a companyName property');
        ok(c.entityAspect.entityState.isUnchanged(), "should be unchanged");
        c.setProperty("CompanyName", "Test");
        ok(c.getProperty("CompanyName") === "Test", "companyName should be 'Test'");
        ok(c.entityAspect.entityState.isModified(), "should be modified after change");
        c.entityAspect.acceptChanges();
        ok(c.entityAspect.entityState.isUnchanged(), "should be unchanged after acceptChanges");

        c.setProperty("CompanyName", "Test2");
        ok(c.getProperty("CompanyName") === "Test2", "companyName should be 'Test2'");
        ok(c.entityAspect.entityState.isModified(), "should be modified after change");
        c.entityAspect.rejectChanges();
        ok(c.getProperty("CompanyName") === "Test", "companyName should be 'Test' after rejectChanges");
        ok(c.entityAspect.entityState.isUnchanged(), "should be unchanged after reject changes");
    }

    function checkDefaultValues(entityType) {
        var props = entityType.getProperties();
        ok(props.length, "No data properties for entityType: " + entityType.name);
        var entity = entityType.createEntity();
        props.forEach(function (p) {
            var v = entity.getProperty(p.name);
            if (p.isDataProperty) {
                if (p.isNullable) {
                    ok(v === null, "value should be null for: " + entityType.name + " -> " + p.name);
                } else {
                    ok(v === p.defaultValue, "incorrect default value for:" + entityType.name + " -> " + p.name);
                }
            } else {
                if (p.isScalar) {
                    ok(v === null, "value should be null for: " + entityType.name + " -> " + p.name);
                } else {
                    ok(v.arrayChanged, "value should be a relation array");
                }
            }
        });
    }


    return testFns;
});