﻿define(function (require) {
    var dataservice = require('services/dataservice');
    var logger = require("logger");

    var suspendItemSave;

    var shellVm = {
        newTodo: ko.observable(""),
        items: ko.observableArray([]),
        addItem: addItem,
        edit: function (item) {
            if (item) { item.isEditing(true); }
        },
        completeEdit: function (item) {
            if (item) { item.isEditing(false); }
        },
        removeItem: function (item) {
            this.items.remove(item);
            item.entityAspect.setDeleted();
            dataservice.saveChanges();
        },
        includeArchived: ko.observable(false),
        archiveCompletedItems: archiveCompletedItems,
        purge: purge,
        reset: reset
    };

    shellVm.includeArchived.subscribe(getAllTodos);
    
    /* Add ko.computed properties */
    
    shellVm.archiveCompletedMessage = ko.computed(function () {
        var count = getStateOfItems().itemsDoneCount;
        if (count > 0) {
            return "Archive " + count + " completed item" + (count > 1 ? "s" : "");
        }
        return null;
    }, shellVm);

    shellVm.itemsLeftMessage = ko.computed(function () {
        var count = getStateOfItems().itemsLeftCount;
        if (count > 0) {
            return count + " item" + (count > 1 ? "s" : "") + " left";
        }

        return null;
    }, shellVm);

    shellVm.markAllCompleted = ko.computed({
        read: function () {
            var state = getStateOfItems();
            return state.itemsLeftCount === 0 && shellVm.items().length > 0;
        },
        write: function (value) {
            suspendItemSave = true;
            shellVm.items().forEach(function (item) {
                item.IsDone(value);
            });
            suspendItemSave = false;
            dataservice.saveChanges();
        },
        owner: shellVm
    });
   
    getAllTodos(); // Start the query 

    return shellVm; // done with setup; return module variable

    /*** Supporting private functions ***/

    function getAllTodos() {
        dataservice.getAllTodos(shellVm.includeArchived())
            .then(processTodoQueryResults)
            .fail(handleQueryErrors);
    }

    function processTodoQueryResults(data) {
        shellVm.items([]);
        data.results.forEach(function (item) {
            extendItem(item);
            shellVm.items.push(item);
        });
        logger.info("Fetched Todos " +
            (shellVm.includeArchived() ? "including archived" : "excluding archived"));
    }

    function handleQueryErrors(error) {
        logger.error(error, "Query failed");
    }

    function extendItem(item) {
        if (item.isEditing) return; // already extended

        item.isEditing = ko.observable(false);

        // listen for changes with Breeze PropertyChanged event
        item.entityAspect.propertyChanged.subscribe(function (args) {
            if (item.propertyChangedPending || suspendItemSave) { return; }
            // throttle property changed response
            // allow time for other property changes (if any) to come through
            item.propertyChangedPending = true;
            setTimeout(function () {
                if (item.entityAspect.validateEntity()) {
                    if (item.entityAspect.entityState.isModified()) {
                        dataservice.saveChanges();
                    }
                } else { // errors
                    handleItemErrors(item);
                    item.isEditing(true); // go back to editing
                }
                item.propertyChangedPending = false;
            }, 10);

        });
    }

    function handleItemErrors(item) {
        if (!item) { return; }
        var errs = item.entityAspect.getValidationErrors();
        if (errs.length == 0) {
            logger.info("No errors for current item");
            return;
        }
        var firstErr = item.entityAspect.getValidationErrors()[0];
        logger.error(firstErr.errorMessage);
        item.entityAspect.rejectChanges(); // harsh for demo 
    }
    
    function addItem() {
        var item = dataservice.createTodo();

        item.IsDone(this.markAllCompleted());
        item.Description(this.newTodo());
        item.CreatedAt(new Date());

        if (item.entityAspect.validateEntity()) {
            extendItem(item);
            this.items.push(item);
            dataservice.saveChanges();
            this.newTodo("");
        } else {
            handleItemErrors(item);
        }
    }
    
    function archiveCompletedItems () {
        var state = getStateOfItems();
        suspendItemSave = true;
        state.itemsDone.forEach(function (item) {
            if (!shellVm.includeArchived()) {
                this.items.remove(item);
            }
            item.IsArchived(true);
        }, this);
        suspendItemSave = false;
        dataservice.saveChanges();
    }
    
    function getStateOfItems() {
        var itemsDone = [], itemsLeft = [];

        shellVm.items().forEach(function (item) {
            if (item.IsDone()) {
                if (!item.IsArchived()) {
                    itemsDone.push(item); // only unarchived items                
                }
            } else {
                itemsLeft.push(item);
            }
        });

        return {
            itemsDone: itemsDone,
            itemsDoneCount: itemsDone.length,
            itemsLeft: itemsLeft,
            itemsLeftCount: itemsLeft.length
        };
    }

    function purge() {
        return dataservice.purge(getAllTodos);
    }

    function reset() {
        return dataservice.reset(getAllTodos);
    }
});