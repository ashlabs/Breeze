// ReSharper disable InconsistentNaming
define(["testFns"], function (testFns) {

    "use strict";

    /*********************************************************
    * Breeze configuration and module setup 
    *********************************************************/
    var entityModel = testFns.breeze.entityModel;
    var core = testFns.breeze.core;

    var Validator = entityModel.Validator;

    var serviceName = testFns.northwindServiceName;
    var newEm = testFns.newEmFactory(serviceName);

    // Capture clean copy of  metadataStore when module 1st runs
    // Keep clean copy because this module adds & removes 
    // validators from the metadata. Must reset after each test.
    var cleanMetadataStore;
    var metadataSetupFn = function (store) {
        cleanMetadataStore = cloneMetadataStore(store);
    };

    var moduleOptions = {
        setup: function () {
            // get the module metadataStore from service first time
            testFns.populateMetadataStore(newEm, metadataSetupFn);
        },
        teardown: function () {
            // reset metadataStore from clean copy after each test
            newEm.options.metadataStore = cloneMetadataStore(cleanMetadataStore);
        }
    };

    module("validationTests", moduleOptions);


    /*********************************************************
    * validates on attach by default (validateOnAttach == true)
    *********************************************************/
    test("validates on attach by default", 1, function () {

        var em = newEm();  // new empty EntityManager
        var empType = getEmployeeType(em);

        var employee = empType.createEntity(); // created but not attached

        // Start monitoring validation error changes
        employee.entityAspect
            .validationErrorsChanged.subscribe(assertTwoErrorsOnAttach);

        // attach entity
        em.attachEntity(employee);

    });

    function assertTwoErrorsOnAttach(errorsChangedArgs) {
        assertGotExpectedValErrorsCount(errorsChangedArgs, 2);
    }

    /*********************************************************
    * does NOT validate on attach when that ValidationOption turned off
    *********************************************************/
    test("does not validate on attach when validateOnAttach option is false", 1, function () {

        var em = newEm();  // new empty EntityManager

        // copy options, changing only "validateOnAttach"
        var valOpts = em.validationOptions.using({ validateOnAttach: false });

        // reset manager's options
        em.setProperties({ validationOptions: valOpts });

        var empType = getEmployeeType(em);

        var employee = empType.createEntity(); // created but not attached

        // attach entity
        em.attachEntity(employee);

        var errors = employee.entityAspect.getValidationErrors();
        equal(errors.length, 0,
            "expected no validation errors and got: " +
                errors.map(function (a) {
                    return a.errorMessage;
                }));

    });

    /*********************************************************
    * Attached employee validation errors raised when properties set to bad values
    *********************************************************/
    test("Attached employee validation errors raised when properties set to bad values", function () {

        var em = newEm();  // new empty EntityManager
        var empType = getEmployeeType(em); ;

        var employee = empType.createEntity(); // created but not attached
        employee.FirstName("John");
        employee.LastName("Doe");

        // enter the cache as 'Unchanged'
        em.attachEntity(employee);

        // Start monitoring validation error changes
        employee.entityAspect
            .validationErrorsChanged.subscribe(assertValidationErrorsChangedRaised);

        employee.LastName(null); // 1. LastName is required

        employee.BirthDate(new Date()); // ok date

        employee.BirthDate(null); // ok. no problem; it's nullable

        employee.BirthDate("today"); // 2. Nice try! Wrong data type

        employee.EmployeeID(null); // 3. Id is the pk; automatically required

        employee.LastName( // 4. adds "too long", 5. removes "required", 
            "IamTheGreatestAndDontYouForgetIt");

        employee.entityAspect.rejectChanges(); // (6, 7, 8) remove ID, Date, LastName errs 

        expect(8); // asserts about validation errors

    });

    function assertValidationErrorsChangedRaised(errorsChangedArgs) {

        var addedMessages = errorsChangedArgs.added.map(function (a) {
            return a.errorMessage;
        });
        var addedCount = addedMessages.length;
        if (addedCount > 0) {
            ok(true, "added error: " + addedMessages.join(", "));
        }

        var removedMessages = errorsChangedArgs.removed.map(function (r) {
            return r.errorMessage;
        });
        var removedCount = removedMessages.length;
        if (removedCount > 0) {
            ok(true, "removed error: " + removedMessages.join(", "));
        }
    }

    /*********************************************************
    * Auto property validation only for attached entity
    *********************************************************/
    test("Auto property validation only for attached entity", 2, function () {
        var emp = createEmployee();

        emp.EmployeeID(null); // value violates ID required

        // but didn't trigger property validation
        // because 'emp' is detached
        var errmsgs = getErrorMessages(emp);
        ok(errmsgs.length === 0,
            "Shows no errors before forced validation: \"{0}\"".format(errmsgs));

        // force validation
        emp.entityAspect.validateEntity();

        errmsgs = getErrorMessages(emp);
        ok(errmsgs.length > 0,
            "Detects errors after force validation: \"{0}\"".format(errmsgs));
    });

    /****** CUSTOM VALIDATORS *******/

    function countryIsUSValidationFn(value, context) {
        if (value == null) return true; // '== null' matches null and empty string
        return value.toUpperCase().startsWith("US");
    };

    // custom validator ensures "Country" is US
    var countryIsUSValidator = new Validator(
        "countryIsUS",              // validator name
        countryIsUSValidationFn,        // validation function
        {                           // validator context
        messageTemplate: "'%displayName%' must start with 'US'"
    });


    function countryValidationFn(value, context) {
        if (value == null) return true; // '== null' matches null and empty string
        return value.toUpperCase().startsWith(context.country.toUpperCase());
    };

    // returns a countryValidator with its parameters filled
    function countryValidatorFactory(context) {

        return new Validator(
            "countryIsIn" + context.country, // validator name
            countryValidationFn,             // validation function
            {                                // validator context
            messageTemplate: "'%displayName%' must start with '%country%'",
            country: context.country
        });
    }

    // The value to assess will be an entity 
    // with Country and PostalCode properties
    function zipCodeValidationFn(entity, context) {
        // This validator only validates US Zip Codes.
        if (entity.getProperty("Country") === "USA") {
            var postalCode = entity.getProperty("PostalCode");
            context.postalCode = postalCode;
            return isValidZipCode(postalCode);
        }
        return true;
    };

    function isValidZipCode(value) {
        var re = /^\d{5}([\-]\d{4})?$/;
        return (re.test(value));
    }

    var zipCodeValidator = new Validator(
        "zipCodeValidator",
         zipCodeValidationFn,
        { messageTemplate: "'%postalCode%' is not a valid US zip code" });

    /*********************************************************
    * Employee can be from Canada (before countryIsInUS validator)
    *********************************************************/
    test("Employee can be from Canada (before countryIsInUS validator)", 1, function () {
        var emp = createEmployee("Wayne", "Gretzky");
        emp.Country("Canada");

        // force validation of unattached employee
        emp.entityAspect.validateEntity();

        // Ok for employee to be from Canada
        var errmsgs = getErrorMessages(emp);
        ok(errmsgs.length === 0,
            "should have no errors: \"{0}\"".format(errmsgs));
    });

    /*********************************************************
    * Employee must be from US (after countryIsInUS validator)
    *********************************************************/
    test("Employee must be from US (after countryIsInUS validator)", 2, function () {
        var em = newEm();
        var emp = createEmployee("Shania", "Twain");
        em.attachEntity(emp);

        // add the US-only validator
        emp.entityType
            .getProperty("Country")
            .validators.push(countryIsUSValidator);

        // non-US employees no longer allowed 
        emp.Country("CA");
        var errmsgs = getErrorMessages(emp);
        ok(errmsgs.length !== 0,
            "should have 1 error: \"{0}\"".format(errmsgs));

        // back in the USA 
        emp.Country("USA");
        errmsgs = getErrorMessages(emp);
        ok(errmsgs.length === 0,
            "should have no errors: \"{0}\"".format(errmsgs));
    });

    /*********************************************************
    * Customer must be from US (after countryIsInUS validator)
    * Illustrates reuse of validator on different entity type
    *********************************************************/
    test("Customer must be in US (after countryIsInUS Validator)", 2, function () {

        var em = newEm();
        var cust = createCustomer("Univ. of Waterloo");
        em.attachEntity(cust);

        // add the US-only validator
        cust.entityType
            .getProperty("Country")
            .validators.push(countryIsUSValidator);

        cust.Country("Canada");
        var errmsgs = getErrorMessages(cust);
        ok(errmsgs.length !== 0,
            "should have 1 error: \"{0}\"".format(errmsgs));

        cust.Country("USA");
        errmsgs = getErrorMessages(cust);
        ok(errmsgs.length === 0,
            "should have no errors: \"{0}\"".format(errmsgs));
    });

    /*********************************************************
    * Customer must be from Canada (after configured countryValidator)
    * Illustrates reuse of validator on different entity type
    *********************************************************/
    test("Customer must be in Canada (after configured countryValidator)", 2, function () {

        var em = newEm();

        // create a Canada-only validator
        var canadaOnly = countryValidatorFactory({ country: "Canada" });

        // add the Canada-only validator
        getCustomerType(em)
            .getProperty("Country")
            .validators.push(canadaOnly);

        var cust = createCustomer("Univ. of Waterloo");
        em.attachEntity(cust);
        cust.Country("USA"); // try to sneak it into the USA

        var errmsgs = getErrorMessages(cust);
        ok(errmsgs.length !== 0,
            "should have 1 error: \"{0}\"".format(errmsgs));

        cust.Country("Canada"); // back where it belongs
        errmsgs = getErrorMessages(cust);
        ok(errmsgs.length === 0,
            "should have no errors: \"{0}\"".format(errmsgs));
    });

    /*********************************************************
    * US Customer must have valid zip code
    *********************************************************/
    test("US Customer must have valid zip code", 2, function () {

        var em = newEm();

        // add US zip code validator to the entity (not to a property)
        getCustomerType(em)
            .validators.push(zipCodeValidator);

        var cust = createCustomer("Boogaloo Board Games");

        em.attachEntity(cust);
        cust.Country("USA");
        cust.PostalCode("N2L 3G1"); // a Canadian postal code

        // Validate the entire entity to engage this rule
        cust.entityAspect.validateEntity();

        var errmsgs = getErrorMessages(cust);
        ok(errmsgs.length !== 0,
            "should have 1 error: \"{0}\"".format(errmsgs));

        cust.Country("Canada");

        cust.entityAspect.validateEntity();

        errmsgs = getErrorMessages(cust);
        ok(errmsgs.length === 0,
            "should have no errors: \"{0}\"".format(errmsgs));
    });

    /*********************************************************
    * Remove a rule ... and an error
    *********************************************************/
    test("Remove a rule", 2, function () {

        var em = newEm();

        var alwaysWrong = new Validator(
            "alwaysWrong",
            function () { return false; },
            { message: "You are always wrong!" }
        );

        var custValidators = getCustomerType(em).validators;

        // add alwaysWrong to the entity (not to a property)
        custValidators.push(alwaysWrong);

        var cust = createCustomer("Presumed Guilty");

        // Attach triggers entity validation by default
        em.attachEntity(cust);

        var errmsgs = getErrorMessages(cust);

        ok(errmsgs.length !== 0,
            "should have 1 error: \"{0}\"".format(errmsgs));

        // remove validation rule
        custValidators.splice(custValidators.indexOf(alwaysWrong), 1);

        // Clear out the "alwaysWrong" error
        // Must do manually because that rule is now gone
        // and, therefore, can't cleanup after itself
        cust.entityAspect.removeValidationError(alwaysWrong);

        cust.entityAspect.validateEntity(); // re-validate

        errmsgs = getErrorMessages(cust);
        ok(errmsgs.length === 0,
            "should have no errors: \"{0}\"".format(errmsgs));
    });

    /*********************************************************
    * Add and remove a (fake) ValidationError
    *********************************************************/
    test("Add and remove a (fake) ValidationError", 3, function () {

        var em = newEm();

        // We need a validator to make a ValidationError
        // but it could be anything and we won't register it
        var fakeValidator = new Validator(
            "fakeValidator",
            function () { return false; },
            { message: "You are always wrong!" }
        );
       
        var cust = createCustomer("Presumed Guilty");
        em.attachEntity(cust);
        
        var errmsgs = getErrorMessages(cust);
        ok(errmsgs.length === 0,
            "should have no errors at test start: \"{0}\"".format(errmsgs));
        
        // create a fake error
        var fakeError = new entityModel.ValidationError(
            fakeValidator,                // the marker validator
            {},                           // validation context
            "You were wrong this time!"   // error message
        );
        
        // add the fake error
        cust.entityAspect.addValidationError(fakeError);

        errmsgs = getErrorMessages(cust);
        ok(errmsgs.length !== 0,
            "should have 1 error after add: \"{0}\"".format(errmsgs));

        // Now remove that error
        cust.entityAspect.removeValidationError(fakeValidator);

        cust.entityAspect.validateEntity(); // re-validate

        errmsgs = getErrorMessages(cust);
        ok(errmsgs.length === 0,
            "should have no errors after remove: \"{0}\"".format(errmsgs));
    });
    
    /*********************************************************
    * TEST HELPERS
    *********************************************************/

    function assertGotExpectedValErrorsCount(errorsChangedArgs, expected) {
        var addedMessages = errorsChangedArgs.added.map(function (a) {
            return a.errorMessage;
        });
        var addedCount = addedMessages.length;
        var pass;
        if (typeof expected === "number") {
            pass = addedCount === expected;
        } else {
            pass = addedCount > 0;
            expected = "some";
        }
        ok(pass,
            "Expected {0} validation errors, got {1}: {2}".format(
                expected, addedCount, addedMessages.join(", ")));
    }

    function getErrorMessages(entity) {
        return getErrorMessagesArray(entity).join(", ");
    }

    function getErrorMessagesArray(entity) {
        return entity.entityAspect
            .getValidationErrors()
            .map(function (err) { return err.errorMessage; })
    }

    function createCustomer(name) {
        var entityType = getCustomerType();
        var cust = entityType.createEntity();
        cust.CompanyName(name || "Acme");
        return cust;
    }
    function createEmployee(firstName, lastName) {
        var entityType = getEmployeeType();
        var emp = entityType.createEntity();
        emp.FirstName(firstName || "John");
        emp.LastName(lastName || "Doe");
        return emp;
    }
    function getEmployeeType(em) {
        return getMetadataStore(em).getEntityType("Employee");
    }
    function getCustomerType(em) {
        return getMetadataStore(em).getEntityType("Customer");
    }
    function getOrderType(em) {
        return getMetadataStore(em).getEntityType("Order");
    }

    function getMetadataStore(em) {
        return (em) ? em.metadataStore : newEm.options.metadataStore;
    }

    function cloneMetadataStore(metadataStore) {
        return new entityModel.MetadataStore()
            .import(metadataStore.export());
    };
});