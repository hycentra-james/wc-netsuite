/**
 * getFedExRateQuote_UE.js
 * User Event Script to get FedEx rate quote when shipping method is updated on Sales Order
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/log', 'N/error', './fedexRateQuote'],
    function (record, log, error, fedexRateQuote) {
        
        // FedEx Shipping Method IDs that should trigger rate quote
        const FEDEX_SHIPPING_METHOD_IDS = [
            3, 15, 3786, 16, 3783, 17, 18, 11597, 11596, 19, 
            3781, 20, 8987, 3782, 14075, 22, 3785, 23, 3784
        ];
        
        /**
         * Before Submit event handler
         * Gets FedEx rate quote when shipping method is updated
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
                
                // Check if status is "Pending Fulfillment"
                var status = newRecord.getText({ fieldId: 'status' });
                if (status !== 'Pending Fulfillment') {
                    log.debug('FedEx Rate Quote', 'Sales Order status is not "Pending Fulfillment", skipping. Status: ' + status);
                    return;
                }
                
                // Check if shipping method changed
                var newShipMethodId = newRecord.getValue({ fieldId: 'shipmethod' });
                var oldShipMethodId = oldRecord ? oldRecord.getValue({ fieldId: 'shipmethod' }) : null;
                
                // If ship method didn't change, skip
                if (newShipMethodId === oldShipMethodId) {
                    log.debug('FedEx Rate Quote', 'Shipping method did not change, skipping');
                    // return;
                }
                
                // Check if new shipping method is in FedEx list
                if (!newShipMethodId || FEDEX_SHIPPING_METHOD_IDS.indexOf(parseInt(newShipMethodId)) === -1) {
                    log.debug('FedEx Rate Quote', 'Shipping method ' + newShipMethodId + ' is not a FedEx method, skipping');
                    return;
                }
                
                log.debug('FedEx Rate Quote', 'Processing rate quote for Sales Order: ' + newRecord.id + ', Ship Method: ' + newShipMethodId);
                
                // Get rate quote (returns object with rate and apiResponse)
                var rateQuoteResult = fedexRateQuote.getRateQuote(newRecord, newShipMethodId);
                var rate = rateQuoteResult.rate;
                var apiResponse = rateQuoteResult.apiResponse;
                
                // Store API response in custom field
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
                
                if (rate && rate > 0) {
                    // Update shipping cost field
                    newRecord.setValue({
                        fieldId: 'shippingcost',
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

