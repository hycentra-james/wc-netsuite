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
                //testModeField.defaultValue = 'T';
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
         * Create test shipment using helper class
         * 
         * @param {Record} fulfillmentRecord
         * @param {string} serviceTypeOverride
         * @param {boolean} testMode
         * @returns {Object}
         */
        function createShipment(fulfillmentRecord, serviceTypeOverride, testMode) {
            // Delegate to helper class for actual shipment creation
            return fedexHelper.createShipment(fulfillmentRecord, serviceTypeOverride, testMode);
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