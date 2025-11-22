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
            3781, 20, 8987, 3782, 14075, 22, 3785, 23, 3784
        ];
        
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
         * Update Sales Order residential flag and address type based on classification
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @param {string} classification The address classification (RESIDENTIAL, BUSINESS, MIXED, UNKNOWN)
         */
        function updateAddressClassification(salesOrderRecord, classification) {
            try {
                log.debug('Update Address Classification', 'Updating classification: ' + classification);
                
                // Determine residential flag and address type
                var isResidential = false;
                var addressType = null;
                
                if (classification === 'RESIDENTIAL') {
                    isResidential = true;
                    addressType = 1; // Residential
                } else if (classification === 'BUSINESS') {
                    isResidential = false;
                    addressType = 2; // Commercial
                } else {
                    // MIXED or UNKNOWN - default to commercial
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
                // Trigger address validation if:
                // A) Shipping method changed TO FedEx (old != FedEx, new == FedEx)
                // B) Address changed while shipping method is already FedEx
                var shouldValidateAddress = false;
                if (isNewFedEx) {
                    if (!isOldFedEx) {
                        // Condition A: Shipping method changed TO FedEx
                        shouldValidateAddress = true;
                        log.debug('FedEx Address Validation', 'Triggering validation: Shipping method changed TO FedEx');
                    } else if (hasShippingAddressChanged(oldRecord, newRecord)) {
                        // Condition B: Address changed while already FedEx
                        shouldValidateAddress = true;
                        log.debug('FedEx Address Validation', 'Triggering validation: Address changed while shipping method is FedEx');
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

