/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget', 'N/record', 'N/search', 'N/log', 'N/redirect', 'N/url', './fedexHelper'],
    function (serverWidget, record, search, log, redirect, url, fedexHelper) {

        /**
         * Handles GET requests - displays the form
         * 
         * @param {Object} context
         */
        function onRequest(context) {
            if (context.request.method === 'GET') {
                displayForm(context);
            } else if (context.request.method === 'POST') {
                processForm(context);
            }
        }

        /**
         * Display the FedEx test form
         * 
         * @param {Object} context
         */
        function displayForm(context) {
            try {
                // Create form
                var form = serverWidget.createForm({
                    title: 'FedEx Integration Test Suite'
                });

                form.addSubmitButton({
                    label: 'Create FedEx Shipment'
                });

                // Add Item Fulfillment selection
                var fulfillmentField = form.addField({
                    id: 'custpage_item_fulfillment',
                    type: serverWidget.FieldType.SELECT,
                    label: 'Select Item Fulfillment',
                    source: 'itemfulfillment'
                });
                fulfillmentField.isMandatory = true;
                fulfillmentField.setHelpText({
                    help: 'Select an Item Fulfillment record to create a FedEx shipment for'
                });

                // Add option to override references
                form.addFieldGroup({
                    id: 'custpage_references_group',
                    label: 'Reference Fields (Optional Overrides)'
                });

                var reference1Field = form.addField({
                    id: 'custpage_reference1',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Shipping Reference 1',
                    container: 'custpage_references_group'
                });
                reference1Field.setHelpText({
                    help: 'Override Reference 1 field for the label (max 30 characters). If blank, will use SO number.'
                });

                var reference2Field = form.addField({
                    id: 'custpage_reference2',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Shipping Reference 2',
                    container: 'custpage_references_group'
                });
                reference2Field.setHelpText({
                    help: 'Override Reference 2 field for the label (max 30 characters). If blank, will use Customer PO.'
                });

                // Add service type override
                var serviceField = form.addField({
                    id: 'custpage_service_type',
                    type: serverWidget.FieldType.SELECT,
                    label: 'FedEx Service Type (Optional Override)',
                    container: 'custpage_references_group'
                });
                serviceField.addSelectOption({
                    value: '',
                    text: '-- Use Default Based on Ship Method --'
                });
                serviceField.addSelectOption({
                    value: 'FEDEX_GROUND',
                    text: 'FedEx Ground'
                });
                serviceField.addSelectOption({
                    value: 'FEDEX_PRIORITY_OVERNIGHT',
                    text: 'FedEx Priority Overnight'
                });
                serviceField.addSelectOption({
                    value: 'FEDEX_2_DAY',
                    text: 'FedEx 2Day'
                });
                serviceField.addSelectOption({
                    value: 'FEDEX_EXPRESS_SAVER',
                    text: 'FedEx Express Saver'
                });

                // Add test mode checkbox
                var testModeField = form.addField({
                    id: 'custpage_test_mode',
                    type: serverWidget.FieldType.CHECKBOX,
                    label: 'Test Mode (Use Sandbox API)'
                });
                testModeField.defaultValue = 'T';
                testModeField.setHelpText({
                    help: 'When checked, uses FedEx sandbox environment for testing'
                });

                // Add recent fulfillments sublist for easy selection
                // addRecentFulfillmentsSublist(form);

                // Add configuration check section
                addConfigurationStatus(form);

                context.response.writePage(form);

            } catch (e) {
                log.error({
                    title: 'Error displaying FedEx test form',
                    details: e.message + '\nStack: ' + e.stack
                });
                context.response.write('Error displaying form: ' + e.message);
            }
        }

        /**
         * Add recent fulfillments sublist for easy selection
         * 
         * @param {Form} form
         */
        function addRecentFulfillmentsSublist(form) {
            try {
                form.addFieldGroup({
                    id: 'custpage_recent_group',
                    label: 'Recent Item Fulfillments'
                });

                var recentSublist = form.addSublist({
                    id: 'custpage_recent_fulfillments',
                    type: serverWidget.SublistType.LIST,
                    label: 'Recent Fulfillments (Last 30 Days)',
                    tab: 'custpage_recent_group'
                });

                recentSublist.addField({
                    id: 'custpage_if_id',
                    type: serverWidget.FieldType.TEXT,
                    label: 'ID'
                });

                recentSublist.addField({
                    id: 'custpage_if_tranid',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Transaction #'
                });

                recentSublist.addField({
                    id: 'custpage_if_customer',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Customer'
                });

                recentSublist.addField({
                    id: 'custpage_if_date',
                    type: serverWidget.FieldType.DATE,
                    label: 'Date'
                });

                recentSublist.addField({
                    id: 'custpage_if_shipmethod',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Ship Method'
                });

                recentSublist.addField({
                    id: 'custpage_if_shipping_status',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Shipping Status'
                });

                // Load recent fulfillments
                var fulfillmentSearch = search.create({
                    type: search.Type.ITEM_FULFILLMENT,
                    filters: [
                        ['trandate', 'within', 'last30days'],
                        'AND',
                        ['mainline', 'is', 'T']
                    ],
                    columns: [
                        'internalid',
                        'tranid',
                        'entity',
                        'trandate',
                        'shipmethod'
                    ]
                });

                var searchResults = fulfillmentSearch.run().getRange({
                    start: 0,
                    end: 20
                });

                for (var i = 0; i < searchResults.length; i++) {
                    var result = searchResults[i];
                    
                    recentSublist.setSublistValue({
                        id: 'custpage_if_id',
                        line: i,
                        value: result.getValue('internalid')
                    });

                    recentSublist.setSublistValue({
                        id: 'custpage_if_tranid',
                        line: i,
                        value: result.getValue('tranid')
                    });

                    recentSublist.setSublistValue({
                        id: 'custpage_if_customer',
                        line: i,
                        value: result.getText('entity')
                    });

                    recentSublist.setSublistValue({
                        id: 'custpage_if_date',
                        line: i,
                        value: result.getValue('trandate')
                    });

                    recentSublist.setSublistValue({
                        id: 'custpage_if_shipmethod',
                        line: i,
                        value: result.getText('shipmethod') || ''
                    });

                    // Try to get shipping status from available fields
                    var shipMethod = result.getText('shipmethod') || '';
                    var carrierStatus = shipMethod ? 'Method: ' + shipMethod : 'No Ship Method';
                    
                    recentSublist.setSublistValue({
                        id: 'custpage_if_shipping_status',
                        line: i,
                        value: carrierStatus
                    });
                }

            } catch (e) {
                log.error({
                    title: 'Error adding recent fulfillments sublist',
                    details: e.message + '\nStack: ' + e.stack
                });
                
                // Add a simple message instead of the sublist if it fails
                try {
                    form.addField({
                        id: 'custpage_sublist_error',
                        type: serverWidget.FieldType.INLINEHTML,
                        label: 'Recent Fulfillments',
                        container: 'custpage_recent_group'
                    }).defaultValue = '<div style="color: orange; padding: 10px;">Unable to load recent fulfillments. Please enter Fulfillment ID manually above.</div>';
                } catch (e2) {
                    // If even this fails, just log it
                    log.debug('Sublist fallback failed', e2.message);
                }
            }
        }

        /**
         * Add configuration status section
         * 
         * @param {Form} form
         */
        function addConfigurationStatus(form) {
            try {
                form.addFieldGroup({
                    id: 'custpage_config_group',
                    label: 'Configuration Status'
                });

                // Check if configuration record exists
                var configStatus = 'Not Configured';
                var configDetails = '';

                try {
                    // Try to load config record directly to avoid token validation issues
                    var tokenRecord = record.load({
                        type: 'customrecord_hyc_fedex_config',
                        id: 1 
                    });
                    
                    if (tokenRecord) {
                        configStatus = 'Configured';
                        
                        var clientId = tokenRecord.getValue({fieldId: 'custrecord_hyc_fedex_client_id'});
                        var endpoint = tokenRecord.getValue({fieldId: 'custrecord_hyc_fedex_endpoint'});
                        var accountNumber = tokenRecord.getValue({fieldId: 'custrecord_hyc_fedex_account_number'});
                        var secret = tokenRecord.getValue({fieldId: 'custrecord_hyc_fedex_secret'});
                        
                        configDetails = 'Client ID: ' + (clientId ? 'Set (' + clientId.substring(0, 8) + '...)' : 'Missing') + '\n' +
                                      'Secret: ' + (secret ? 'Set' : 'Missing') + '\n' +
                                      'Endpoint: ' + (endpoint || 'Not Set') + '\n' +
                                      'Account: ' + (accountNumber ? 'Set (' + accountNumber + ')' : 'Missing');
                    }
                } catch (e) {
                    configStatus = 'Configuration Error: ' + e.message;
                    configDetails = 'Please check the custom record configuration.\n\nError details: ' + e.message;
                }

                var statusField = form.addField({
                    id: 'custpage_config_status',
                    type: serverWidget.FieldType.LONGTEXT,
                    label: 'Configuration Status',
                    container: 'custpage_config_group'
                });
                statusField.defaultValue = configStatus + '\n\n' + configDetails;
                statusField.updateDisplayType({
                    displayType: serverWidget.FieldDisplayType.INLINE
                });

                // Add setup instructions
                var instructionsField = form.addField({
                    id: 'custpage_instructions',
                    type: serverWidget.FieldType.LONGTEXT,
                    label: 'Setup Instructions',
                    container: 'custpage_config_group'
                });
                instructionsField.defaultValue = 
                    'Required Custom Record: customrecord_hyc_fedex_config\n' +
                    'Required Fields:\n' +
                    '- custrecord_hyc_fedex_client_id (FedEx API Key)\n' +
                    '- custrecord_hyc_fedex_secret (FedEx Secret Key)\n' +
                    '- custrecord_hyc_fedex_account_number (FedEx Account Number)\n' +
                    '- custrecord_hyc_fedex_endpoint (API Endpoint URL)\n' +
                    '- custrecord_hyc_fedex_access_token (Auto-generated)\n' +
                    '- custrecord_hyc_fedex_expiration (Auto-generated)\n\n' +
                    'Required Custom Body Fields on Item Fulfillment:\n' +
                    '- custbody_fedex_reference1 (Reference 1)\n' +
                    '- custbody_fedex_reference2 (Reference 2)\n' +
                    '- custbody_fedex_tracking_number (Tracking Number)\n' +
                    '- custbody_fedex_label_url (Label URL)\n' +
                    '- custbody_fedex_shipment_id (Shipment ID)\n' +
                    '- custbody_fedex_error_message (Error Message)\n' +
                    '- custbody_fedex_api_response (API Response)';
                
                instructionsField.updateDisplayType({
                    displayType: serverWidget.FieldDisplayType.INLINE
                });

            } catch (e) {
                log.error({
                    title: 'Error adding configuration status',
                    details: e.message
                });
            }
        }

        /**
         * Process form submission
         * 
         * @param {Object} context
         */
        function processForm(context) {
            try {
                var request = context.request;
                var fulfillmentId = request.parameters.custpage_item_fulfillment;
                var reference1Override = request.parameters.custpage_reference1;
                var reference2Override = request.parameters.custpage_reference2;
                var serviceTypeOverride = request.parameters.custpage_service_type;
                var testMode = request.parameters.custpage_test_mode === 'T';

                if (!fulfillmentId) {
                    throw new Error('Please select an Item Fulfillment record');
                }

                log.debug('FedEx Test', 'Processing fulfillment ID: ' + fulfillmentId);
                log.debug('FedEx Test', 'Test Mode: ' + testMode);
                log.debug('FedEx Test', 'Reference 1 Override: ' + reference1Override);
                log.debug('FedEx Test', 'Reference 2 Override: ' + reference2Override);

                // Load the fulfillment record
                var fulfillmentRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId
                });

                // Apply overrides if provided
                if (reference1Override) {
                    fulfillmentRecord.setValue({
                        fieldId: 'custbody_shipping_reference1',
                        value: reference1Override.substring(0, 30)
                    });
                }

                if (reference2Override) {
                    fulfillmentRecord.setValue({
                        fieldId: 'custbody_shipping_reference2',
                        value: reference2Override.substring(0, 30)
                    });
                }

                // Create FedEx shipment
                var result = createShipment(fulfillmentRecord, serviceTypeOverride, testMode);

                // Redirect to results page
                var resultUrl = url.resolveScript({
                    scriptId: getScriptId(),
                    deploymentId: getDeploymentId(),
                    params: {
                        action: 'result',
                        fulfillment_id: fulfillmentId,
                        success: result.success,
                        message: result.message,
                        tracking: result.trackingNumber || '',
                        label_url: result.labelUrl || ''
                    }
                });

                redirect.redirect({
                    url: resultUrl
                });

            } catch (e) {
                log.error({
                    title: 'Error processing FedEx test form',
                    details: e.message + '\nStack: ' + e.stack
                });

                // Redirect to error page
                var errorUrl = url.resolveScript({
                    scriptId: getScriptId(),
                    deploymentId: getDeploymentId(),
                    params: {
                        action: 'result',
                        success: 'false',
                        message: 'Error: ' + e.message
                    }
                });

                redirect.redirect({
                    url: errorUrl
                });
            }
        }

        /**
         * Create test shipment
         * 
         * @param {Record} fulfillmentRecord
         * @param {string} serviceTypeOverride
         * @param {boolean} testMode
         * @returns {Object}
         */
        function createShipment(fulfillmentRecord, serviceTypeOverride, testMode) {
            try {
                // Build shipment payload
                var payload = fedexHelper.buildShipmentPayload(fulfillmentRecord);

                // Apply service type override if provided
                if (serviceTypeOverride) {
                    payload.requestedShipment.serviceType = serviceTypeOverride;
                }

                // Get API configuration and force token refresh
                var tokenRecord = fedexHelper.getTokenRecord();
                
                // Log current configuration for verification
                
                var apiKey = tokenRecord.getValue({fieldId: 'custrecord_hyc_fedex_client_id'});
                var secretKey = tokenRecord.getValue({fieldId: 'custrecord_hyc_fedex_secret'});
                var accountNumber = tokenRecord.getValue({fieldId: 'custrecord_hyc_fedex_account_number'});
                var endpoint = tokenRecord.getValue({fieldId: 'custrecord_hyc_fedex_endpoint'});
                
                log.debug('DEBUG', 'Current Client ID (first 10 chars): ' + (apiKey ? apiKey.substring(0, 10) + '...' : 'EMPTY'));
                log.debug('DEBUG', 'Current Client Secret (first 10 chars): ' + (secretKey ? secretKey.substring(0, 10) + '...' : 'EMPTY'));
                log.debug('DEBUG', 'Current Account Number: ' + accountNumber);
                log.debug('DEBUG', 'Current Endpoint: ' + endpoint);
                
                // If API key is empty, show error
                if (!apiKey || !secretKey) {
                    throw error.create({
                        name: 'MISSING_CREDENTIALS',
                        message: 'Client ID or Client Secret is empty in NetSuite custom record. Please update the HYC FedEx Configuration record with your new FedEx API credentials.'
                    });
                }
                
                // Clear any existing token to force fresh authentication
                log.debug('DEBUG', 'Clearing existing token and forcing refresh...');
                tokenRecord.setValue({fieldId: 'custrecord_hyc_fedex_access_token', value: ''});
                tokenRecord.setValue({fieldId: 'custrecord_hyc_fedex_expiration', value: ''});
                tokenRecord.save();
                
                // Force token refresh to ensure new credentials are used
                log.debug('DEBUG', 'Refreshing token with new credentials...');
                var refreshResult = fedexHelper.refreshToken(tokenRecord);
                
                // Get the actual bearer token from the refreshed record
                var bearerToken = '';
                if (refreshResult) {
                    // refreshToken returns the updated record, so get token from it
                    bearerToken = refreshResult.getValue({fieldId: 'custrecord_hyc_fedex_access_token'}) || '';
                    log.debug('DEBUG', 'Token refresh result: Success - Token: ' + (bearerToken ? bearerToken.substring(0, 20) + '...' : 'No token found in record'));
                } else {
                    log.debug('DEBUG', 'Token refresh result: Failed - no record returned');
                }
                
                if (!bearerToken) {
                    throw error.create({
                        name: 'TOKEN_REFRESH_FAILED',
                        message: 'Failed to obtain bearer token after refresh'
                    });
                }
                
                var apiUrl = fedexHelper.getApiUrl();

                apiUrl += 'ship/v1/shipments';

                log.audit('FedEx Test API Call', 'URL: ' + apiUrl);
                log.debug('FedEx Test Payload', JSON.stringify(payload, null, 2));
                
                // Enhanced debugging for field validation
                log.debug('FedEx Shipper Details', JSON.stringify(payload.requestedShipment.shipper, null, 2));
                log.debug('FedEx Recipient Details', JSON.stringify(payload.requestedShipment.recipients[0], null, 2));
                log.debug('FedEx Package Details', JSON.stringify(payload.requestedShipment.requestedPackageLineItems[0], null, 2));
                log.debug('FedEx Service Info', 'Service: ' + payload.requestedShipment.serviceType + ', Packaging: ' + payload.requestedShipment.packagingType + ', Pickup: ' + payload.requestedShipment.pickupType);
                log.debug('FedEx Ship Date', 'Date: ' + payload.requestedShipment.shipDatestamp);
                log.debug('FedEx Account Number', 'Account: ' + payload.accountNumber.value);
                
                // Check for potential validation issues
                var shipper = payload.requestedShipment.shipper;
                var recipient = payload.requestedShipment.recipients[0];
                var package = payload.requestedShipment.requestedPackageLineItems[0];
                
                // Phone number validation
                if (shipper.contact.phoneNumber) {
                    log.debug('Shipper Phone Validation', 'Phone: "' + shipper.contact.phoneNumber + '", Length: ' + shipper.contact.phoneNumber.length + ', Is Numeric: ' + /^\d+$/.test(shipper.contact.phoneNumber));
                }
                if (recipient.contact.phoneNumber) {
                    log.debug('Recipient Phone Validation', 'Phone: "' + recipient.contact.phoneNumber + '", Length: ' + recipient.contact.phoneNumber.length + ', Is Numeric: ' + /^\d+$/.test(recipient.contact.phoneNumber));
                }
                
                // Weight/dimension validation
                log.debug('Package Weight Validation', 'Weight: ' + package.weight.value + ' ' + package.weight.units);
                log.debug('Package Dimension Validation', 'Dimensions: ' + package.dimensions.length + 'x' + package.dimensions.width + 'x' + package.dimensions.height + ' ' + package.dimensions.units);
                
                // Date validation
                var today = new Date();
                var shipDate = new Date(payload.requestedShipment.shipDatestamp);
                log.debug('Date Validation', 'Ship Date: ' + payload.requestedShipment.shipDatestamp + ', Today: ' + today.toISOString().split('T')[0] + ', Valid: ' + (shipDate >= today));
                
                // Reference validation
                if (package.customerReferences) {
                    for (var r = 0; r < package.customerReferences.length; r++) {
                        var ref = package.customerReferences[r];
                        log.debug('Reference Validation', 'Type: ' + ref.customerReferenceType + ', Value: "' + ref.value + '", Length: ' + ref.value.length);
                    }
                }

                // Make API call
                var response = fedexHelper.postToApi(bearerToken, apiUrl, JSON.stringify(payload));

                log.audit('FedEx Test Response', 'Status: ' + response.status);
                log.debug('FedEx Test Response Body', JSON.stringify(response.result, null, 2));

                // Process response
                var trackingNumber = '';
                var labelUrls = [];
                var transactionId = '';
                var alertsJson = '';

                if (response.result && response.result.output && response.result.output.transactionShipments) {
                    var shipments = response.result.output.transactionShipments;
                    if (shipments.length > 0) {
                        var firstShipment = shipments[0];
                        
                        // Extract tracking number
                        if (firstShipment.masterTrackingNumber) {
                            trackingNumber = firstShipment.masterTrackingNumber;
                        }
                        
                        // Extract label URLs from all piece responses
                        if (firstShipment.pieceResponses && firstShipment.pieceResponses.length > 0) {
                            for (var i = 0; i < firstShipment.pieceResponses.length; i++) {
                                var pieceResponse = firstShipment.pieceResponses[i];
                                if (pieceResponse.packageDocuments && pieceResponse.packageDocuments.length > 0) {
                                    for (var j = 0; j < pieceResponse.packageDocuments.length; j++) {
                                        var packageDoc = pieceResponse.packageDocuments[j];
                                        if (packageDoc.url && packageDoc.contentType === 'LABEL') {
                                            labelUrls.push(packageDoc.url);
                                        }
                                    }
                                }
                            }
                        }
                        
                        // Extract alerts for error message field
                        if (firstShipment.alerts && firstShipment.alerts.length > 0) {
                            alertsJson = JSON.stringify(firstShipment.alerts);
                        }
                    }
                    
                    // Extract transaction ID from top level
                    if (response.result.transactionId) {
                        transactionId = response.result.transactionId;
                    }
                }

                // Join multiple label URLs with comma
                var labelUrlString = labelUrls.join(',');

                log.debug('FedEx Response Processing', 'Tracking: ' + trackingNumber + 
                         ', Labels: ' + labelUrlString + 
                         ', Transaction ID: ' + transactionId +
                         ', Alerts: ' + alertsJson);

                // Update the fulfillment record with results (in test mode, just log)
                if (!testMode) {
                    // For non-test mode, update the actual record with generic fields
                    var updateValues = {
                        custbody_shipping_label_url: labelUrlString,
                        custbody_shipment_transaction_id: transactionId,
                        custbody_shipping_api_response: JSON.stringify(response.result)
                    };
                    
                    // Only add error message if there are alerts
                    if (alertsJson) {
                        updateValues.custbody_shipping_error_message = alertsJson;
                    }
                    
                    record.submitFields({
                        type: record.Type.ITEM_FULFILLMENT,
                        id: fulfillmentRecord.id,
                        values: updateValues
                    });
                    
                    // Update package tracking numbers - need to reload record for packages
                    if (trackingNumber) {
                        var recordForUpdate = record.load({
                            type: record.Type.ITEM_FULFILLMENT,
                            id: fulfillmentRecord.id
                        });
                        
                        var packageCount = recordForUpdate.getLineCount({sublistId: 'package'});
                        if (packageCount > 0) {
                            recordForUpdate.setSublistValue({
                                sublistId: 'package',
                                fieldId: 'packagetrackingnumber',
                                line: 0,
                                value: trackingNumber
                            });
                            recordForUpdate.save();
                        }
                    }
                } else {
                    // In test mode, just log the values that would be updated
                    log.audit('Test Mode - Would Update Fields', JSON.stringify({
                        custbody_shipping_label_url: labelUrlString,
                        custbody_shipment_transaction_id: transactionId,
                        custbody_shipping_api_response: 'Full API Response (truncated for log)',
                        custbody_shipping_error_message: alertsJson,
                        packagetrackingnumber: trackingNumber
                    }));
                }

                return {
                    success: true,
                    message: 'FedEx shipment created successfully!' + (testMode ? ' (Test Mode)' : ''),
                    trackingNumber: trackingNumber,
                    labelUrl: labelUrlString,
                    transactionId: transactionId,
                    alerts: alertsJson
                };

            } catch (e) {
                log.error({
                    title: 'FedEx Test Shipment Error',
                    details: e.message + '\nStack: ' + e.stack
                });

                return {
                    success: false,
                    message: e.message
                };
            }
        }

        /**
         * Get current script ID (you'll need to update this with actual script ID)
         * 
         * @returns {string}
         */
        function getScriptId() {
            return 'customscript_fedex_test_suitelet'; // Update with actual script ID
        }

        /**
         * Get current deployment ID (you'll need to update this with actual deployment ID)
         * 
         * @returns {string}
         */
        function getDeploymentId() {
            return 'customdeploy_fedex_test_suitelet'; // Update with actual deployment ID
        }

        return {
            onRequest: onRequest
        };
    }
); 