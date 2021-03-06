﻿define(function (require) {
    var breeze = require('breeze'),
        core = breeze.core,
        entityModel = breeze.entityModel;

    var logger = require('logger');

    // Configure for Knockout binding and Web API persistence services
    core.config.setProperties({
        trackingImplementation: entityModel.entityTracking_ko,
        remoteAccessImplementation: entityModel.remoteAccess_webApi
    });

    var op = entityModel.FilterQueryOp,
        todoType,
        serviceName = 'api/todos',
        manager = new entityModel.EntityManager(serviceName);

    manager.fetchMetadata()
        .then(function () {
            logger.success("Got metadata");
            // grab the entity type info after metadata returned from server
            todoType = manager.metadataStore.getEntityType("TodoItem");
        })
        .fail(function (error) {
            logger.error(error, "Failed to get metadata");
        });

    return {
        getAllTodos: getAllTodos,
        createTodo: createTodo,
        saveChanges: saveChanges,
        saveChangesAfterDelay: function () { // Delay save while UI updates the entity
            setTimeout(saveChanges, 0); // trickier if saveChanges returned a promise
        },
        purge: purge,
        reset: reset

    };

    function getAllTodos(includeArchived) {
        var query = new entityModel.EntityQuery()
                .from("Todos")
                .orderBy("CreatedAt");

        if (!includeArchived) {
            query = query.where("IsArchived", op.Equals, false);
        }

        return manager.executeQuery(query);
    };

    function createTodo() {
        var newTodo = todoType.createEntity();
        return manager.addEntity(newTodo);
    };

    function saveChanges() {
        if (manager.hasChanges()) {
            manager.saveChanges()
                .then(function (saveResult) {
                    logger.success("# of Todos saved = " + saveResult.entities.length);
                    logger.log(saveResult);
                })
                .fail(handleSaveError);
        } else {
            logger.info("Nothing to save");
        };
    };

    function handleSaveError(error) {
        var reason = error.message;
        var detail = error.detail;
        
        if (reason === "Validation error") {
            handleSaveValidationError(error);
            return;
        }
        if (detail && detail.ExceptionType.indexOf('OptimisticConcurrencyException') !== -1) {
            // Concurrency error 
            reason =
                "Another user, perhaps the server, may have deleted one or all of the todos.";
            manager.rejectChanges(); // DEMO ONLY: discard all pending changes
        }

        logger.error(error,
            "Failed to save changes. " + reason +
            " You may have to restart the app.");
    };
    
    function handleSaveValidationError(error) {
        var message = "Not saved due to validation error";
        try { // fish out the first error
            var firstErr = error.entitiesWithErrors[0].entityAspect.getValidationErrors()[0];
            message += ": " + firstErr.errorMessage;
        } catch (e) { /* eat it for now */ }
        logger.error(message);
    };
    
    function purge(callback) {
        // Todo: breeze should support commands to the controller
        // Simplified: fails silently
        $.post(serviceName + '/purge', function () {
            logger.success("database purged.");
            if (callback) callback();
        });
    };

    function reset(callback) {
        // Todo: breeze should support commands to the controller
        // Simplified: fails silently
        $.post(serviceName + '/reset', function () {
            logger.success("database reset.");
            if (callback) callback();
        });
    };

});