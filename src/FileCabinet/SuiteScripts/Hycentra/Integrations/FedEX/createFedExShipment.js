/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/log', 'N/error', './fedexHelper'],
    function (record, log, error, fedexHelper) {
        
        /**
         * Before Submit event handler
         * Creates FedEx shipment when Item Fulfillment is created or edited
         *
         * @param {Object} context - Script context
         */
        function beforeSubmit(context) {
            var currentRecord = context.type === context.UserEventType.CREATE ? context.newRecord : context.newRecord;

            try {
                log.debug('FedEx Integration', '----------------------------------------------------');
                log.debug('DEBUG', 'beforeSubmit() - FedEx Integration');
                log.debug('DEBUG', 'context.type = ' + context.type);
                log.debug('DEBUG', 'currentRecord.id = ' + currentRecord.id);
                log.debug('DEBUG', 'currentRecord.type = ' + currentRecord.type);

                // Only process Item Fulfillment records
                if (currentRecord.type !== 'itemfulfillment') {
                    log.debug('DEBUG', 'Skipping - not an Item Fulfillment record');
                    return;
                }

                // Check if this fulfillment should be processed by a shipping carrier
                var carrierType = getShippingCarrier(currentRecord);
                if (carrierType !== 'FEDEX') {
                    log.debug('DEBUG', 'Skipping - not a FedEx shipment, carrier: ' + carrierType);
                    return;
                }

                if (context.type === context.UserEventType.CREATE) {
                    log.debug('DEBUG', 'Processing CREATE event for FedEx shipment');
                    createFedExShipment(currentRecord);
                } else if (context.type === context.UserEventType.EDIT) {
                    log.debug('DEBUG', 'Processing EDIT event for FedEx shipment');
                    
                    // Check if shipment already exists by looking at packages
                    var hasExistingTracking = checkForExistingTracking(currentRecord);
                    if (!hasExistingTracking) {
                        createFedExShipment(currentRecord);
                    } else {
                        log.debug('DEBUG', 'FedEx shipment already exists - tracking found in packages');
                    }
                }

            } catch (e) {
                log.error({
                    title: 'FedEx Integration Error',
                    details: 'Error in beforeSubmit: ' + e.message + '\nStack: ' + e.stack
                });
                
                // Set error message on the record for user visibility
                currentRecord.setValue({
                    fieldId: 'custbody_shipping_error_message',
                    value: 'FedEx Integration Error: ' + e.message
                });
            }

            log.debug('DEBUG', 'End beforeSubmit() - FedEx Integration');
        }

        /**
         * Check if the fulfillment already has tracking numbers in packages
         *
         * @param {record} fulfillmentRecord - The Item Fulfillment record
         * @returns {boolean} True if tracking numbers already exist
         */
        function checkForExistingTracking(fulfillmentRecord) {
            try {
                var packageCount = fulfillmentRecord.getLineCount({sublistId: 'package'});
                log.debug('DEBUG', 'Package count: ' + packageCount);
                
                for (var i = 0; i < packageCount; i++) {
                    var trackingNumber = fulfillmentRecord.getSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagetrackingnumber',
                        line: i
                    });
                    
                    if (trackingNumber) {
                        log.debug('DEBUG', 'Found existing tracking number in package ' + i + ': ' + trackingNumber);
                        return true;
                    }
                }
                
                return false;
            } catch (e) {
                log.error({
                    title: 'Error checking existing tracking',
                    details: e.message
                });
                return false;
            }
        }

        /**
         * Determine which shipping carrier should process this Item Fulfillment
         *
         * @param {record} fulfillmentRecord - The Item Fulfillment record
         * @returns {string} Shipping carrier type ('FEDEX', 'UPS', 'OTHER', or null)
         */
        function getShippingCarrier(fulfillmentRecord) {
            // Check shipcarrier field first (if available)
            try {
                var shipCarrier = fulfillmentRecord.getText({fieldId: 'shipcarrier'}) || '';
                log.debug('DEBUG', 'Ship Carrier: ' + shipCarrier);
                
                if (shipCarrier.toUpperCase().indexOf('FEDEX') !== -1) {
                    return 'FEDEX';
                } else if (shipCarrier.toUpperCase().indexOf('UPS') !== -1) {
                    return 'UPS';
                }
            } catch (e) {
                log.debug('DEBUG', 'shipcarrier field not available or error: ' + e.message);
            }

            // Fall back to shipping method analysis
            var shipMethodId = fulfillmentRecord.getValue({fieldId: 'shipmethod'});
            var shipMethodText = fulfillmentRecord.getText({fieldId: 'shipmethod'}) || '';
            
            log.debug('DEBUG', 'Ship Method ID: ' + shipMethodId + ', Text: ' + shipMethodText);
            
            // Check if shipping method indicates FedEx
            var fedexShippingMethods = [
                'FEDEX GROUND',
                'FEDEX PRIORITY OVERNIGHT', 
                'FEDEX 2DAY',
                'FEDEX EXPRESS SAVER',
                'FEDEX STANDARD OVERNIGHT'
            ];
            
            var isFedExMethod = fedexShippingMethods.some(function(method) {
                return shipMethodText.toUpperCase().indexOf(method) !== -1;
            });

            if (isFedExMethod) {
                log.debug('DEBUG', 'Shipping method indicates FedEx: ' + shipMethodText);
                return 'FEDEX';
            }

            // Check if shipping method indicates UPS
            var upsShippingMethods = [
                'UPS GROUND',
                'UPS NEXT DAY AIR',
                'UPS 2ND DAY AIR',
                'UPS 3 DAY SELECT'
            ];
            
            var isUPSMethod = upsShippingMethods.some(function(method) {
                return shipMethodText.toUpperCase().indexOf(method) !== -1;
            });

            if (isUPSMethod) {
                log.debug('DEBUG', 'Shipping method indicates UPS: ' + shipMethodText);
                return 'UPS';
            }

            log.debug('DEBUG', 'No matching carrier found for shipping method: ' + shipMethodText);
            return null;
        }

        /**
         * Create FedEx shipment via API
         *
         * @param {record} fulfillmentRecord - The Item Fulfillment record
         */
        function createFedExShipment(fulfillmentRecord) {
            try {
                log.debug('DEBUG', 'createFedExShipment() - Starting FedEx API call');

                // Build the shipment payload
                var payload = fedexHelper.buildShipmentPayload(fulfillmentRecord);
                
                // Get authentication token and API URL
                var tokenRecord = fedexHelper.getTokenRecord();
                var bearerToken = tokenRecord.getValue({fieldId: 'custrecord_hyc_fedex_access_token'});
                var baseApiUrl = fedexHelper.getApiUrl();
                
                // Ensure baseApiUrl ends with trailing slash
                if (!baseApiUrl.endsWith('/')) {
                    baseApiUrl = baseApiUrl + '/';
                }
                
                var apiUrl = baseApiUrl + 'ship/v1/shipments';

                log.debug('DEBUG', 'FedEx API URL: ' + apiUrl);
                log.debug('DEBUG', 'FedEx Payload: ' + JSON.stringify(payload));

                // Make the API call
                var response = fedexHelper.postToApi(bearerToken, apiUrl, JSON.stringify(payload));

                log.debug('DEBUG', 'FedEx API Response Status: ' + response.status);
                log.debug('DEBUG', 'FedEx API Response: ' + JSON.stringify(response.result));

                // Process successful response
                if (response.status === 200 || response.status === 201) {
                    processFedExResponse(fulfillmentRecord, response.result);
                } else {
                    throw error.create({
                        name: 'FEDEX_API_ERROR',
                        message: 'FedEx API returned status ' + response.status + ': ' + JSON.stringify(response.result)
                    });
                }

            } catch (e) {
                log.error({
                    title: 'FedEx Shipment Creation Error',
                    details: 'Error creating FedEx shipment: ' + e.message + '\nStack: ' + e.stack
                });
                throw e;
            }
        }

        /**
         * Process FedX API response and update NetSuite record
         *
         * @param {record} fulfillmentRecord - The Item Fulfillment record
         * @param {Object} fedexResponse - The FedX API response
         */
        function processFedExResponse(fulfillmentRecord, fedexResponse) {
            try {
                log.debug('DEBUG', 'processFedExResponse() - Processing FedX response');

                // Extract tracking numbers and labels from response
                var trackingNumbers = [];
                var labelUrls = [];
                var shipmentId = '';

                // FedX response structure may vary - adjust as needed
                if (fedexResponse.output && fedexResponse.output.transactionShipments) {
                    var shipments = fedexResponse.output.transactionShipments;
                    if (shipments.length > 0) {
                        var firstShipment = shipments[0];
                        
                        // Get tracking numbers and labels
                        if (firstShipment.completedShipmentDetail && 
                            firstShipment.completedShipmentDetail.completedPackageDetails &&
                            firstShipment.completedShipmentDetail.completedPackageDetails.length > 0) {
                            
                            var packageDetails = firstShipment.completedShipmentDetail.completedPackageDetails;
                            
                            for (var i = 0; i < packageDetails.length; i++) {
                                var packageDetail = packageDetails[i];
                                
                                // Get tracking number
                                if (packageDetail.trackingIds && packageDetail.trackingIds.length > 0) {
                                    trackingNumbers.push(packageDetail.trackingIds[0].trackingNumber);
                                }

                                // Get label URL
                                if (packageDetail.label && packageDetail.label.encodedLabel) {
                                    labelUrls.push(packageDetail.label.encodedLabel);
                                }
                            }
                        }

                        // Get shipment ID
                        if (firstShipment.shipmentId) {
                            shipmentId = firstShipment.shipmentId;
                        }
                    }
                }

                log.debug('DEBUG', 'Extracted Tracking Numbers: ' + JSON.stringify(trackingNumbers));
                log.debug('DEBUG', 'Extracted Label URLs count: ' + labelUrls.length);
                log.debug('DEBUG', 'Extracted Shipment ID: ' + shipmentId);

                // Update package records with tracking numbers
                updatePackageTrackingNumbers(fulfillmentRecord, trackingNumbers);

                // Update generic body fields
                var fieldsToUpdate = {};

                // Store label URLs (comma-separated if multiple)
                if (labelUrls.length > 0) {
                    fieldsToUpdate.custbody_shipping_label_url = labelUrls.join(',');
                }

                if (shipmentId) {
                    fieldsToUpdate.custbody_shipping_shipment_id = shipmentId;
                }

                // Store the full response for reference
                fieldsToUpdate.custbody_shipping_api_response = JSON.stringify(fedexResponse);
                
                // Clear any previous error messages
                fieldsToUpdate.custbody_shipping_error_message = '';

                // Update the record
                if (Object.keys(fieldsToUpdate).length > 0) {
                    for (var fieldId in fieldsToUpdate) {
                        fulfillmentRecord.setValue({
                            fieldId: fieldId,
                            value: fieldsToUpdate[fieldId]
                        });
                    }
                    log.debug('DEBUG', 'Updated Item Fulfillment with shipping data');
                }

            } catch (e) {
                log.error({
                    title: 'FedX Response Processing Error',
                    details: 'Error processing FedX response: ' + e.message + '\nStack: ' + e.stack
                });
                throw e;
            }
        }

        /**
         * Update package records with tracking numbers
         *
         * @param {record} fulfillmentRecord - The Item Fulfillment record  
         * @param {Array} trackingNumbers - Array of tracking numbers from FedX
         */
        function updatePackageTrackingNumbers(fulfillmentRecord, trackingNumbers) {
            try {
                var packageCount = fulfillmentRecord.getLineCount({sublistId: 'package'});
                log.debug('DEBUG', 'Updating ' + packageCount + ' packages with ' + trackingNumbers.length + ' tracking numbers');
                
                for (var i = 0; i < packageCount && i < trackingNumbers.length; i++) {
                    fulfillmentRecord.setSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagetrackingnumber',
                        line: i,
                        value: trackingNumbers[i]
                    });
                    
                    log.debug('DEBUG', 'Set package ' + i + ' tracking number: ' + trackingNumbers[i]);
                }

            } catch (e) {
                log.error({
                    title: 'Error updating package tracking numbers',
                    details: e.message + '\nStack: ' + e.stack
                });
            }
        }

        /**
         * Get tracking numbers from packages
         *
         * @param {record} fulfillmentRecord - The Item Fulfillment record
         * @returns {Array} Array of tracking numbers
         */
        function getPackageTrackingNumbers(fulfillmentRecord) {
            var trackingNumbers = [];
            try {
                var packageCount = fulfillmentRecord.getLineCount({sublistId: 'package'});
                
                for (var i = 0; i < packageCount; i++) {
                    var trackingNumber = fulfillmentRecord.getSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagetrackingnumber',
                        line: i
                    });
                    
                    if (trackingNumber) {
                        trackingNumbers.push(trackingNumber);
                    }
                }
                
            } catch (e) {
                log.error({
                    title: 'Error getting package tracking numbers',
                    details: e.message
                });
            }
            
            return trackingNumbers;
        }

        /**
         * After Submit event handler
         * Can be used for additional processing after the record is saved
         *
         * @param {Object} context - Script context
         */
        function afterSubmit(context) {
            try {
                // Add any post-processing logic here if needed
                // For example: send notifications, update related records, etc.
                
                if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.EDIT) {
                    var currentRecord = context.newRecord;
                    
                    // Check for tracking numbers in packages
                    var trackingNumbers = getPackageTrackingNumbers(currentRecord);
                    
                    if (trackingNumbers.length > 0) {
                        log.audit({
                            title: 'FedX Shipment Created Successfully', 
                            details: 'Item Fulfillment ID: ' + currentRecord.id + ', Tracking Numbers: ' + trackingNumbers.join(', ')
                        });
                    }
                }

            } catch (e) {
                log.error({
                    title: 'FedEx After Submit Error',
                    details: 'Error in afterSubmit: ' + e.message
                });
            }
        }

        return {
            beforeSubmit: beforeSubmit,
            afterSubmit: afterSubmit
        };
    }
); 