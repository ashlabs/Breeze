/// <reference path="datajs/datajs-1.0.2.js" />
/// <reference path="q/q.js"/>
/// <reference path="OQuery/oQuery.mod.js"/>
/// <reference path="iblade/core.js" />
/// <reference path="iblade/entitymetadata.js"/>
/// <reference path="iblade/entitymanager.js"/>
/// <reference path="iblade/entity.js"/>
// above stuff for resharper - but doesn't work

require.config({ baseUrl: "Scripts/IBlade" });
define(["testFns"], function (testFns) {
    var root = testFns.root;
    var core = root.core;
    var entityModel = root.entityModel;

    var EntityType = entityModel.EntityType;
    var MetadataStore = entityModel.MetadataStore;

    module("metadata", {
        setup: function () {
        },
        teardown: function () {

        }
    });

    test("default interface impl", function() {
        var store = new MetadataStore();
        stop();
        store.fetchMetadata(testFns.ServiceName).then(function() {
            ok(!store.isEmpty());
            start();
        }).fail(testFns.handleFail);
    });
    
    asyncTest("initialization", function () {

        var store = new MetadataStore();

        testFns.remoteAccess.fetchMetadata(store, testFns.ServiceName, function () {

            var typeMap = store._entityTypeMap;
            var types = objectValues(typeMap);
            ok(types.length > 0);
            var custType = store.getEntityType("Customer");
            var props = custType.dataProperties;
            ok(props.length > 0);
            var keys = custType.keyProperties;
            ok(keys.length > 0);
            var prop = custType.getProperty("CustomerID");
            ok(prop);
            ok(prop.isDataProperty);
            var navProp = custType.navigationProperties[0];
            ok(navProp.isNavigationProperty);
            var notProp = custType.getProperty("foo");
            ok(!notProp);
            equals(prop.name, keys[0].name);
            start();
        });
    });

    test("initialization concurrent", function () {

        var store = new MetadataStore();
        var sc = new testFns.StopCount(2);
        var typeMap;
        var errFn = function (e) {
            ok(false, e);
            sc.start();
        };
        testFns.remoteAccess.fetchMetadata(store, testFns.ServiceName, function () {
            typeMap = store._entityTypeMap;
            sc.start();
        }, errFn);
        testFns.remoteAccess.fetchMetadata(store, testFns.ServiceName, function () {
            typeMap = store._entityTypeMap;
            sc.start();
        }, errFn);
    });

    function objectValues(obj, deep) {
        deep = deep || false;
        var result = [];
        for (var name in obj) {
            if (deep || obj.hasOwnProperty(name)) {
                result.push(obj[name]);
            }
        }
        return result;
    }

    return testFns;
});
