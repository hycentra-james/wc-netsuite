/**
 * getFedExRateQuote_UE.js
 * User Event Script to get FedEx rate quote and validate address when shipping method is updated on Sales Order
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/log', 'N/error', './fedexRateQuote', './fedexAddressValidation'],
    function (record, search, log, error, fedexRateQuote, fedexAddressValidation) {
        
        // FedEx Shipping Method IDs that should trigger rate quote
        const FEDEX_SHIPPING_METHOD_IDS = [
            3, 15, 3786, 16, 3783, 17, 18, 11597, 11596, 19,
            3781, 20, 8987, 3782, 14075, 22, 3785, 23, 3784,
            14686 // FedEx One Rate Envelope
        ];

        // Customer constants for order type identification
        const WEBSITE_PARENT_CUSTOMER_ID = 330;
        const EDI_CUSTOMER_IDS = [329, 275, 317, 12703]; // Home Depot = 317, Home Depot Pro = 12703, Lowe's = 275, Wayfair = 329

        // FedEx shipping method IDs for Ground and Home Delivery
        const FEDEX_GROUND_ID = 19;
        const FEDEX_HOME_ID = 20;

        // Ship Type constants (custcol_fmt_ship_type from customlist_fmt_ship_type_list)
        const SHIP_TYPE_SMALL_PARCEL = 1;
        const SHIP_TYPE_LTL = 2;
        
        /**
         * Check if shipping address has changed between old and new record
         *
         * @param {record} oldRecord The old Sales Order record
         * @param {record} newRecord The new Sales Order record
         * @returns {boolean} True if address changed, false otherwise
         */
        function hasShippingAddressChanged(oldRecord, newRecord) {
            try {
                // Get old address subrecord
                var oldAddressSubrecord = null;
                try {
                    oldAddressSubrecord = oldRecord.getSubrecord({ fieldId: 'shippingaddress' });
                } catch (e) {
                    // Old record might not have address, treat as changed
                    return true;
                }
                
                // Get new address subrecord
                var newAddressSubrecord = null;
                try {
                    newAddressSubrecord = newRecord.getSubrecord({ fieldId: 'shippingaddress' });
                } catch (e) {
                    // New record might not have address, treat as changed
                    return true;
                }
                
                // Compare address fields
                var oldAddr1 = (oldAddressSubrecord ? oldAddressSubrecord.getValue({ fieldId: 'addr1' }) : '') || '';
                var newAddr1 = (newAddressSubrecord ? newAddressSubrecord.getValue({ fieldId: 'addr1' }) : '') || '';
                
                var oldAddr2 = (oldAddressSubrecord ? oldAddressSubrecord.getValue({ fieldId: 'addr2' }) : '') || '';
                var newAddr2 = (newAddressSubrecord ? newAddressSubrecord.getValue({ fieldId: 'addr2' }) : '') || '';
                
                var oldCity = (oldAddressSubrecord ? oldAddressSubrecord.getValue({ fieldId: 'city' }) : '') || '';
                var newCity = (newAddressSubrecord ? newAddressSubrecord.getValue({ fieldId: 'city' }) : '') || '';
                
                var oldState = (oldAddressSubrecord ? oldAddressSubrecord.getValue({ fieldId: 'state' }) : '') || '';
                var newState = (newAddressSubrecord ? newAddressSubrecord.getValue({ fieldId: 'state' }) : '') || '';
                
                var oldZip = (oldAddressSubrecord ? oldAddressSubrecord.getValue({ fieldId: 'zip' }) : '') || '';
                var newZip = (newAddressSubrecord ? newAddressSubrecord.getValue({ fieldId: 'zip' }) : '') || '';
                
                var oldCountry = (oldAddressSubrecord ? oldAddressSubrecord.getValue({ fieldId: 'country' }) : '') || '';
                var newCountry = (newAddressSubrecord ? newAddressSubrecord.getValue({ fieldId: 'country' }) : '') || '';
                
                // Check if any field changed
                if (oldAddr1 !== newAddr1 || oldAddr2 !== newAddr2 || oldCity !== newCity || 
                    oldState !== newState || oldZip !== newZip || oldCountry !== newCountry) {
                    log.debug('Address Comparison', 'Shipping address changed');
                    return true;
                }
                
                log.debug('Address Comparison', 'Shipping address unchanged');
                return false;
                
            } catch (e) {
                log.error({
                    title: 'Address Comparison Error',
                    details: 'Error comparing addresses: ' + e.message
                });
                // On error, assume address changed to be safe
                return true;
            }
        }

        /**
         * Determine the order type based on customer
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {string} Order type: 'WEBSITE', 'EDI', or 'OTHER'
         */
        function getOrderType(salesOrderRecord) {
            try {
                var customerId = salesOrderRecord.getValue({ fieldId: 'entity' });
                if (!customerId) {
                    log.debug('Get Order Type', 'No customer ID found');
                    return 'OTHER';
                }

                // Check if customer is in EDI list
                if (EDI_CUSTOMER_IDS.indexOf(parseInt(customerId)) !== -1) {
                    log.debug('Get Order Type', 'Customer ' + customerId + ' is EDI customer');
                    return 'EDI';
                }

                // Check if customer's parent is Website parent AND otherrefnum starts with "WEB-"
                try {
                    var customerLookup = search.lookupFields({
                        type: search.Type.CUSTOMER,
                        id: customerId,
                        columns: ['parent']
                    });
                    var parentId = customerLookup.parent && customerLookup.parent.length > 0 ?
                        customerLookup.parent[0].value : null;

                    if (parentId && parseInt(parentId) === WEBSITE_PARENT_CUSTOMER_ID) {
                        // Also check if otherrefnum starts with "WEB-"
                        var otherRefNum = salesOrderRecord.getValue({ fieldId: 'otherrefnum' }) || '';
                        if (otherRefNum.toString().indexOf('WEB-') === 0) {
                            log.debug('Get Order Type', 'Customer ' + customerId + ' has Website parent (' + parentId + ') and otherrefnum starts with WEB- (' + otherRefNum + ')');
                            return 'WEBSITE';
                        } else {
                            log.debug('Get Order Type', 'Customer ' + customerId + ' has Website parent but otherrefnum does not start with WEB- (' + otherRefNum + ')');
                        }
                    }
                } catch (lookupError) {
                    log.debug('Get Order Type', 'Could not lookup customer parent: ' + lookupError.message);
                }

                log.debug('Get Order Type', 'Customer ' + customerId + ' is OTHER type');
                return 'OTHER';

            } catch (e) {
                log.error({
                    title: 'Get Order Type Error',
                    details: 'Error determining order type: ' + e.message
                });
                return 'OTHER';
            }
        }

        /**
         * Check if any line item on the Sales Order has LTL ship type
         * If ANY item is LTL, the entire order is considered LTL
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {boolean} True if order contains any LTL items, false if all Small Parcel
         */
        function isOrderLTL(salesOrderRecord) {
            try {
                var lineCount = salesOrderRecord.getLineCount({ sublistId: 'item' });

                if (lineCount === 0) {
                    log.debug('Is Order LTL', 'No line items found, defaulting to Small Parcel');
                    return false;
                }

                for (var i = 0; i < lineCount; i++) {
                    var shipType = salesOrderRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_fmt_ship_type',
                        line: i
                    });

                    if (parseInt(shipType) === SHIP_TYPE_LTL) {
                        log.debug('Is Order LTL', 'Found LTL item on line ' + i + ', order is LTL');
                        return true;
                    }
                }

                log.debug('Is Order LTL', 'All items are Small Parcel');
                return false;

            } catch (e) {
                log.error({
                    title: 'Is Order LTL Error',
                    details: 'Error checking ship type: ' + e.message
                });
                // Default to Small Parcel on error
                return false;
            }
        }

        /**
         * Update shipping method based on address classification and order type
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @param {string} classification The address classification
         * @param {string} orderType The order type (WEBSITE, EDI, OTHER)
         * @param {number} currentShipMethodId The current shipping method ID
         */
        function updateShippingMethod(salesOrderRecord, classification, orderType, currentShipMethodId) {
            try {
                // Determine target shipping method based on classification
                // RESIDENTIAL, MIXED, UNKNOWN → FedEx Home (20)
                // BUSINESS → FedEx Ground (19)
                var targetShipMethodId = FEDEX_HOME_ID; // Default to FedEx Home
                if (classification === 'BUSINESS') {
                    targetShipMethodId = FEDEX_GROUND_ID;
                }

                var shouldUpdateShipMethod = false;

                if (orderType === 'WEBSITE') {
                    // Website orders: Always update shipping method
                    shouldUpdateShipMethod = true;
                    log.debug('Update Shipping Method', 'Website order - will update shipping method');
                } else if (orderType === 'EDI') {
                    // EDI orders: Only update if current method is Ground (19) or Home (20)
                    var currentMethodInt = parseInt(currentShipMethodId);
                    if (currentMethodInt === FEDEX_GROUND_ID || currentMethodInt === FEDEX_HOME_ID) {
                        shouldUpdateShipMethod = true;
                        log.debug('Update Shipping Method', 'EDI order with Ground/Home method - will update shipping method');
                    } else {
                        log.debug('Update Shipping Method', 'EDI order with non-Ground/Home method (' + currentShipMethodId + ') - preserving original method');
                    }
                } else {
                    // OTHER orders: Don't update shipping method
                    log.debug('Update Shipping Method', 'Other order type - not updating shipping method');
                }

                if (shouldUpdateShipMethod) {
                    var currentMethodInt = parseInt(currentShipMethodId);
                    if (currentMethodInt !== targetShipMethodId) {
                        salesOrderRecord.setValue({
                            fieldId: 'shipmethod',
                            value: targetShipMethodId
                        });
                        log.audit({
                            title: 'Shipping Method Updated',
                            details: 'Sales Order: ' + salesOrderRecord.id + ', Order Type: ' + orderType +
                                ', Classification: ' + classification + ', Old Method: ' + currentShipMethodId +
                                ', New Method: ' + targetShipMethodId
                        });
                    } else {
                        log.debug('Update Shipping Method', 'Shipping method already correct: ' + targetShipMethodId);
                    }
                }

            } catch (e) {
                log.error({
                    title: 'Update Shipping Method Error',
                    details: 'Error updating shipping method: ' + e.message
                });
                // Don't throw - let the order save proceed
            }
        }

        /**
         * Update Sales Order residential flag and address type based on classification
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @param {string} classification The address classification (RESIDENTIAL, BUSINESS, MIXED, UNKNOWN)
         */
        function updateAddressClassification(salesOrderRecord, classification) {
            try {
                log.debug('Update Address Classification', 'Updating classification: ' + classification);
                
                // Determine residential flag and address type
                // RESIDENTIAL, MIXED, UNKNOWN → Residential (default)
                // BUSINESS → Commercial
                var isResidential = true;
                var addressType = 1; // Default to Residential

                if (classification === 'BUSINESS') {
                    isResidential = false;
                    addressType = 2; // Commercial
                }
                
                // Update shipisresidential field on Sales Order record
                try {
                    salesOrderRecord.setValue({
                        fieldId: 'shipisresidential',
                        value: isResidential
                    });
                    log.debug('Update Address Classification', 'Updated shipisresidential on Sales Order to: ' + isResidential);
                } catch (fieldError) {
                    log.debug('Update Address Classification', 'Could not set shipisresidential field on Sales Order: ' + fieldError.message);
                }
                
                // Also update residential flag on shipping address subrecord if it exists
                try {
                    var shippingAddressSubrecord = salesOrderRecord.getSubrecord({ fieldId: 'shippingaddress' });
                    if (shippingAddressSubrecord) {
                        // Try to set residential field on the subrecord (try multiple possible field names)
                        var subrecordFieldNames = ['isresidential', 'shipisresidential', 'residential'];
                        var subrecordFieldSet = false;
                        
                        for (var i = 0; i < subrecordFieldNames.length; i++) {
                            try {
                                shippingAddressSubrecord.setValue({
                                    fieldId: subrecordFieldNames[i],
                                    value: isResidential
                                });
                                log.debug('Update Address Classification', 'Updated ' + subrecordFieldNames[i] + ' on shipping address subrecord to: ' + isResidential);
                                subrecordFieldSet = true;
                                break; // Successfully set, exit loop
                            } catch (subrecordFieldError) {
                                // Try next field name
                                continue;
                            }
                        }
                        
                        if (!subrecordFieldSet) {
                            log.debug('Update Address Classification', 'Could not set residential field on shipping address subrecord (tried: ' + subrecordFieldNames.join(', ') + ')');
                        }
                    }
                } catch (subrecordError) {
                    log.debug('Update Address Classification', 'Could not access shipping address subrecord: ' + subrecordError.message);
                }
                
                // Update custbody_hyc_address_type field
                try {
                    salesOrderRecord.setValue({
                        fieldId: 'custbody_hyc_address_type',
                        value: addressType
                    });
                    log.debug('Update Address Classification', 'Updated custbody_hyc_address_type to: ' + addressType);
                } catch (fieldError) {
                    log.debug('Update Address Classification', 'Could not set custbody_hyc_address_type field: ' + fieldError.message);
                }
                
                log.audit({
                    title: 'Address Classification Updated',
                    details: 'Sales Order: ' + salesOrderRecord.id + ', Classification: ' + classification + ', Residential: ' + isResidential + ', Type: ' + addressType
                });
                
            } catch (e) {
                log.error({
                    title: 'Update Address Classification Error',
                    details: 'Error updating address classification: ' + e.message
                });
                throw e;
            }
        }

        /**
         * Update address classification for EDI orders based on ship method
         * Skips FedEx API and forces address type to match ship method
         * Ground (19) → Commercial, Home (20) → Residential
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @param {number} shipMethodId The shipping method ID (19=Ground, 20=Home)
         */
        function updateAddressClassificationForEDI(salesOrderRecord, shipMethodId) {
            try {
                var isResidential;
                var addressType;
                var shipMethodName;

                if (parseInt(shipMethodId) === FEDEX_GROUND_ID) {
                    // FedEx Ground → Force Commercial
                    isResidential = false;
                    addressType = 2;
                    shipMethodName = 'FedEx Ground';
                } else if (parseInt(shipMethodId) === FEDEX_HOME_ID) {
                    // FedEx Home → Force Residential
                    isResidential = true;
                    addressType = 1;
                    shipMethodName = 'FedEx Home';
                } else {
                    log.debug('EDI Address Classification', 'Ship method ' + shipMethodId + ' is not Ground or Home, skipping');
                    return;
                }

                log.debug('EDI Address Classification', 'Skipping FedEx API - respecting ship method assigned by EDI customer. Ship Method: ' + shipMethodName + ' (' + shipMethodId + ')');
                log.debug('EDI Address Classification', 'Forcing address type: ' + (isResidential ? 'Residential' : 'Commercial'));

                // Update shipisresidential field
                try {
                    salesOrderRecord.setValue({
                        fieldId: 'shipisresidential',
                        value: isResidential
                    });
                    log.debug('EDI Address Classification', 'Updated shipisresidential to: ' + isResidential);
                } catch (fieldError) {
                    log.debug('EDI Address Classification', 'Could not set shipisresidential: ' + fieldError.message);
                }

                // Update shipping address subrecord
                try {
                    var shippingAddressSubrecord = salesOrderRecord.getSubrecord({ fieldId: 'shippingaddress' });
                    if (shippingAddressSubrecord) {
                        var subrecordFieldNames = ['isresidential', 'shipisresidential', 'residential'];
                        for (var i = 0; i < subrecordFieldNames.length; i++) {
                            try {
                                shippingAddressSubrecord.setValue({
                                    fieldId: subrecordFieldNames[i],
                                    value: isResidential
                                });
                                log.debug('EDI Address Classification', 'Updated ' + subrecordFieldNames[i] + ' on subrecord to: ' + isResidential);
                                break;
                            } catch (subrecordFieldError) {
                                continue;
                            }
                        }
                    }
                } catch (subrecordError) {
                    log.debug('EDI Address Classification', 'Could not access shipping address subrecord: ' + subrecordError.message);
                }

                // Update custbody_hyc_address_type field
                try {
                    salesOrderRecord.setValue({
                        fieldId: 'custbody_hyc_address_type',
                        value: addressType
                    });
                    log.debug('EDI Address Classification', 'Updated custbody_hyc_address_type to: ' + addressType);
                } catch (fieldError) {
                    log.debug('EDI Address Classification', 'Could not set custbody_hyc_address_type: ' + fieldError.message);
                }

                log.audit({
                    title: 'EDI Address Classification Forced',
                    details: 'Sales Order: ' + salesOrderRecord.id + ', Ship Method: ' + shipMethodName + ', Forced to: ' + (isResidential ? 'Residential' : 'Commercial')
                });

            } catch (e) {
                log.error({
                    title: 'EDI Address Classification Error',
                    details: 'Error updating address classification for EDI: ' + e.message
                });
            }
        }

        /**
         * Before Submit event handler
         * Validates address and gets FedEx rate quote when shipping method is updated
         *
         * @param {Object} context - Script context
         */
        function beforeSubmit(context) {
            try {
                var newRecord = context.newRecord;
                var oldRecord = context.oldRecord;
                
                // Only process Sales Orders
                if (newRecord.type !== 'salesorder') {
                    return;
                }
                
                var newShipMethodId = newRecord.getValue({ fieldId: 'shipmethod' });
                var oldShipMethodId = oldRecord ? oldRecord.getValue({ fieldId: 'shipmethod' }) : null;
                
                // Check if shipping method is FedEx
                var isNewFedEx = newShipMethodId && FEDEX_SHIPPING_METHOD_IDS.indexOf(parseInt(newShipMethodId)) !== -1;
                var isOldFedEx = oldShipMethodId && FEDEX_SHIPPING_METHOD_IDS.indexOf(parseInt(oldShipMethodId)) !== -1;
                
                // Check status BEFORE any setValue calls (must use getText before setValue)
                var isPendingFulfillment = false;
                
                // Check if this is a CREATE operation (new Sales Order)
                log.debug('FedEx Rate Quote', 'Context type: ' + context.type);
                var isCreateOperation = (context.type === context.UserEventType.CREATE) || !oldRecord;
                
                if (isCreateOperation) {
                    // For new Sales Orders, assume they are in "Pending Fulfillment" status
                    isPendingFulfillment = true;
                    log.debug('FedEx Rate Quote', 'New Sales Order detected, assuming Pending Fulfillment status');
                } else {
                    // For existing records (EDIT), try to get status text
                    try {
                        var status = newRecord.getText({ fieldId: 'status' });
                        isPendingFulfillment = (status === 'Pending Fulfillment');
                    } catch (e) {
                        log.debug('FedEx Rate Quote', 'Could not get status: ' + e.message);
                        // If we can't determine status, default to false to be safe
                        isPendingFulfillment = false;
                    }
                }
                
                // ===== ADDRESS VALIDATION LOGIC =====
                // Determine order type for CREATE operations
                var orderType = isCreateOperation ? getOrderType(newRecord) : null;

                // Check if order is LTL (any line item has LTL ship type)
                var orderIsLTL = isCreateOperation ? isOrderLTL(newRecord) : false;

                // Determine if we should validate address
                var shouldValidateAddress = false;
                var shouldUpdateShipMethod = false;

                if (isCreateOperation) {
                    // CREATE operation logic based on order type
                    if (orderType === 'WEBSITE') {
                        // Website orders: Always validate on CREATE
                        shouldValidateAddress = true;
                        // Only update ship method for Small Parcel orders
                        if (orderIsLTL) {
                            shouldUpdateShipMethod = false;
                            log.debug('FedEx Address Validation', 'Website LTL order CREATE - validation only, no ship method update');
                        } else {
                            shouldUpdateShipMethod = true;
                            log.debug('FedEx Address Validation', 'Website Small Parcel order CREATE - validation and ship method update');
                        }
                    } else if (orderType === 'EDI') {
                        // EDI orders: Different handling for Small Parcel vs LTL
                        if (orderIsLTL) {
                            // LTL: Call FedEx API to classify address, no ship method change
                            shouldValidateAddress = true;
                            shouldUpdateShipMethod = false;
                            log.debug('FedEx Address Validation', 'EDI LTL order CREATE - calling API for address classification');
                        } else {
                            // Small Parcel - check if current method is Ground (19) or Home (20)
                            var currentMethodInt = parseInt(newShipMethodId);
                            if (currentMethodInt === FEDEX_GROUND_ID || currentMethodInt === FEDEX_HOME_ID) {
                                // Skip FedEx API, force address type based on ship method
                                shouldValidateAddress = false;
                                shouldUpdateShipMethod = false;
                                // Force address classification based on ship method (Ground→Commercial, Home→Residential)
                                updateAddressClassificationForEDI(newRecord, currentMethodInt);
                                log.debug('FedEx Address Validation', 'EDI Small Parcel order CREATE - skipped API, forced address type based on ship method');
                            } else {
                                // Other FedEx methods or non-FedEx: No validation or updates
                                shouldValidateAddress = false;
                                shouldUpdateShipMethod = false;
                                log.debug('FedEx Address Validation', 'EDI Small Parcel order CREATE with non-Ground/Home method (' + newShipMethodId + ') - no action');
                            }
                        }
                    } else {
                        // OTHER orders: Only validate if FedEx method (existing behavior)
                        if (isNewFedEx) {
                            shouldValidateAddress = true;
                            log.debug('FedEx Address Validation', 'Other order CREATE with FedEx method - triggering address validation');
                        }
                    }
                } else {
                    // EDIT operation: Keep existing logic
                    // Validate if shipping method changed TO FedEx or address changed while FedEx
                    if (isNewFedEx) {
                        if (!isOldFedEx) {
                            shouldValidateAddress = true;
                            log.debug('FedEx Address Validation', 'Shipping method changed TO FedEx - triggering validation');
                        } else if (hasShippingAddressChanged(oldRecord, newRecord)) {
                            shouldValidateAddress = true;
                            log.debug('FedEx Address Validation', 'Address changed while FedEx - triggering validation');
                        }
                    }
                }

                if (shouldValidateAddress) {
                    try {
                        log.debug('FedEx Address Validation', 'Processing address validation for Sales Order: ' + newRecord.id);

                        // Call address validation API
                        var validationResult = fedexAddressValidation.validateAddress(newRecord);
                        var classification = validationResult.classification;
                        var apiResponse = validationResult.apiResponse;

                        // Store API response in custom field
                        try {
                            newRecord.setValue({
                                fieldId: 'custbody_shipping_api_response',
                                value: JSON.stringify(apiResponse)
                            });
                        } catch (fieldError) {
                            log.debug('FedEx Address Validation', 'Could not set custbody_shipping_api_response field: ' + fieldError.message);
                        }

                        // Update residential flag and address type
                        updateAddressClassification(newRecord, classification);

                        // Update shipping method for Website and EDI orders on CREATE
                        if (shouldUpdateShipMethod && isCreateOperation) {
                            updateShippingMethod(newRecord, classification, orderType, newShipMethodId);
                            // Re-read the ship method as it may have been updated
                            newShipMethodId = newRecord.getValue({ fieldId: 'shipmethod' });
                            isNewFedEx = newShipMethodId && FEDEX_SHIPPING_METHOD_IDS.indexOf(parseInt(newShipMethodId)) !== -1;
                        }

                    } catch (e) {
                        // Log error but don't block save
                        log.error({
                            title: 'FedEx Address Validation Error',
                            details: 'Error validating address: ' + e.message + '\nStack: ' + e.stack
                        });

                        // Store API response if available (even for errors)
                        try {
                            if (e.apiResponse) {
                                newRecord.setValue({
                                    fieldId: 'custbody_shipping_api_response',
                                    value: JSON.stringify(e.apiResponse)
                                });
                            }
                        } catch (fieldError) {
                            log.debug('FedEx Address Validation', 'Could not set custbody_shipping_api_response field: ' + fieldError.message);
                        }
                    }
                }
                
                // ===== RATE QUOTE LOGIC =====
                // Check if status is "Pending Fulfillment" (using variable checked before setValue calls)
                if (!isPendingFulfillment) {
                    log.debug('FedEx Rate Quote', 'Sales Order status is not "Pending Fulfillment", skipping. Status: ' + status);
                    return;
                }
                
                var newActualShippingCost = newRecord.getValue({ fieldId: 'custbody_fmt_actual_shipping_cost' }) || 0;
                
                // Condition 1: Check if new shipping method is in FedEx list
                if (!isNewFedEx) {
                    log.debug('FedEx Rate Quote', 'Shipping method ' + newShipMethodId + ' is not a FedEx method, skipping');
                    return;
                }
                
                // Condition 2: Check if Actual Shipping Cost is already set (should be 0)
                if (newActualShippingCost > 0) {
                    log.debug('FedEx Rate Quote', 'Actual Shipping Cost is already set (' + newActualShippingCost + '), skipping');
                    return;
                }
                
                // Condition 3: Check if customer has a specific FedEx account (mapping record)
                var customerId = newRecord.getValue({ fieldId: 'entity' });
                var mappingRecord = null;
                
                if (customerId && newShipMethodId) {
                    try {
                        var mappingSearch = search.create({
                            type: 'customrecord_hyc_shipping_label_mapping',
                            filters: [
                                ['custrecord_hyc_ship_lbl_map_customer', search.Operator.ANYOF, customerId],
                                'AND',
                                ['custrecord_hyc_ship_lbl_map_ship_method', search.Operator.ANYOF, newShipMethodId]
                            ],
                            columns: ['custrecord_hyc_ship_lbl_ship_from']
                        });
                        
                        var searchResults = mappingSearch.run().getRange({ start: 0, end: 1 });
                        if (searchResults && searchResults.length > 0) {
                            mappingRecord = searchResults[0];
                            log.debug('FedEx Rate Quote', 'Customer ' + customerId + ' has specific FedEx account mapping, skipping rate quote');
                            return;
                        }
                    } catch (e) {
                        log.debug('Mapping Lookup Warning', 'Could not check mapping record: ' + e.message);
                    }
                }
                
                
                log.debug('FedEx Rate Quote', 'Processing rate quote for Sales Order: ' + newRecord.id + ', Ship Method: ' + newShipMethodId);
                
                // Get rate quote (returns object with rate and apiResponse)
                var rateQuoteResult = fedexRateQuote.getRateQuote(newRecord);
                var rate = rateQuoteResult.rate;
                var apiResponse = rateQuoteResult.apiResponse;
                
                // Store API response in custom field
                /*
                try {
                    newRecord.setValue({
                        fieldId: 'custbody_shipping_api_response',
                        value: JSON.stringify(apiResponse)
                    });
                } catch (fieldError) {
                    log.debug('FedEx Rate Quote', 'Could not set custbody_shipping_api_response field: ' + fieldError.message);
                }
                
                // Clear error message on success
                try {
                    newRecord.setValue({
                        fieldId: 'custbody_shipping_error_message',
                        value: ''
                    });
                } catch (fieldError) {
                    // Field might not exist, ignore
                }
                */
                
                if (rate && rate > 0) {
                    // Update shipping cost field
                    newRecord.setValue({
                        fieldId: 'custbody_fmt_actual_shipping_cost',
                        value: rate
                    });
                    
                    log.debug('FedEx Rate Quote', 'Updated shipping cost to: ' + rate);
                    log.audit({
                        title: 'FedEx Rate Quote Updated',
                        details: 'Sales Order: ' + newRecord.id + ', Rate: $' + rate
                    });
                } else {
                    log.warning({
                        title: 'FedEx Rate Quote Warning',
                        details: 'Rate quote returned invalid value: ' + rate
                    });
                }
                
            } catch (e) {
                // Log error but don't block save
                log.error({
                    title: 'FedEx Rate Quote Error',
                    details: 'Error getting FedEx rate quote: ' + e.message + '\nStack: ' + e.stack
                });
                
                // Store API response if available (even for errors)
                try {
                    if (e.apiResponse) {
                        newRecord.setValue({
                            fieldId: 'custbody_shipping_api_response',
                            value: JSON.stringify(e.apiResponse)
                        });
                    }
                } catch (fieldError) {
                    log.debug('FedEx Rate Quote', 'Could not set custbody_shipping_api_response field: ' + fieldError.message);
                }
                
                // Set error message on record
                try {
                    var errorMessage = 'FedEx Rate Quote Error: ' + e.message;
                    // Include API error details if available
                    if (e.apiResponse && e.apiResponse.errors && e.apiResponse.errors.length > 0) {
                        var apiErrors = [];
                        for (var i = 0; i < e.apiResponse.errors.length; i++) {
                            apiErrors.push(e.apiResponse.errors[i].code + ': ' + e.apiResponse.errors[i].message);
                        }
                        errorMessage += ' | API Errors: ' + apiErrors.join('; ');
                    }
                    newRecord.setValue({
                        fieldId: 'custbody_shipping_error_message',
                        value: errorMessage
                    });
                } catch (fieldError) {
                    // Field might not exist, ignore
                    log.debug('FedEx Rate Quote', 'Could not set custbody_shipping_error_message field: ' + fieldError.message);
                }
            }
        }
        
        return {
            beforeSubmit: beforeSubmit
        };
    }
);

