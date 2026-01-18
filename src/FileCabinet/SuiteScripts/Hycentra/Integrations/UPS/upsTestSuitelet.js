/**
 * upsTestSuitelet.js
 * Suitelet for testing UPS integration manually
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget', 'N/record', 'N/log', './upsHelper', './upsAddressValidation', './upsRateQuote'],
    function (serverWidget, record, log, upsHelper, upsAddressValidation, upsRateQuote) {

        /**
         * Suitelet entry point
         *
         * @param {Object} context - Script context
         */
        function onRequest(context) {
            if (context.request.method === 'GET') {
                displayForm(context);
            } else {
                processForm(context);
            }
        }

        /**
         * Display the test form
         *
         * @param {Object} context - Script context
         */
        function displayForm(context) {
            var form = serverWidget.createForm({
                title: 'UPS Integration Test'
            });

            // Add test mode checkbox
            form.addField({
                id: 'custpage_test_mode',
                type: serverWidget.FieldType.CHECKBOX,
                label: 'Use Sandbox (Test Mode)'
            }).defaultValue = 'T';

            // Add configuration status
            addConfigurationStatus(form);

            // Test Type selection
            var testTypeField = form.addField({
                id: 'custpage_test_type',
                type: serverWidget.FieldType.SELECT,
                label: 'Test Type'
            });
            testTypeField.addSelectOption({ value: '', text: '-- Select Test --' });
            testTypeField.addSelectOption({ value: 'token', text: 'Test OAuth Token Refresh' });
            testTypeField.addSelectOption({ value: 'address', text: 'Test Address Validation' });
            testTypeField.addSelectOption({ value: 'rate', text: 'Test Rate Quote' });
            testTypeField.addSelectOption({ value: 'shipment', text: 'Test Shipment Creation' });

            // Sales Order ID for address/rate testing
            form.addField({
                id: 'custpage_sales_order_id',
                type: serverWidget.FieldType.TEXT,
                label: 'Sales Order Internal ID (for Address/Rate tests)'
            });

            // Item Fulfillment ID for shipment testing
            form.addField({
                id: 'custpage_fulfillment_id',
                type: serverWidget.FieldType.TEXT,
                label: 'Item Fulfillment Internal ID (for Shipment test)'
            });

            // Save labels checkbox (for shipment test)
            var saveLabelsField = form.addField({
                id: 'custpage_save_labels',
                type: serverWidget.FieldType.CHECKBOX,
                label: 'Save Labels to File Cabinet (for Shipment test)'
            });
            saveLabelsField.setHelpText({ help: 'When checked, labels will be saved to the "UPS Labels" folder in the File Cabinet even in test mode.' });

            // Add submit button
            form.addSubmitButton({
                label: 'Run Test'
            });

            // Results area
            var resultsField = form.addField({
                id: 'custpage_results',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Test Results'
            });

            // Check for previous results
            var previousResults = context.request.parameters.results;
            if (previousResults) {
                resultsField.defaultValue = '<div style="margin-top: 20px; padding: 15px; border: 1px solid #ccc; background-color: #f9f9f9;"><h3>Test Results</h3><pre style="white-space: pre-wrap;">' + decodeURIComponent(previousResults) + '</pre></div>';
            }

            context.response.writePage(form);
        }

        /**
         * Add configuration status to the form
         *
         * @param {Object} form - The form object
         */
        function addConfigurationStatus(form) {
            try {
                var sandboxStatus = 'Not Configured';
                var productionStatus = 'Not Configured';

                // Check sandbox config
                try {
                    var sandboxRecord = record.load({
                        type: 'customrecord_hyc_ups_config',
                        id: 1
                    });
                    var sandboxEndpoint = sandboxRecord.getValue({ fieldId: 'custrecord_hyc_ups_endpoint' }) || '';
                    var sandboxClientId = sandboxRecord.getValue({ fieldId: 'custrecord_hyc_ups_client_id' }) || '';
                    if (sandboxEndpoint && sandboxClientId) {
                        sandboxStatus = 'Configured (' + sandboxEndpoint + ')';
                    }
                } catch (e) {
                    sandboxStatus = 'Error: ' + e.message;
                }

                // Check production config
                try {
                    var prodRecord = record.load({
                        type: 'customrecord_hyc_ups_config',
                        id: 2
                    });
                    var prodEndpoint = prodRecord.getValue({ fieldId: 'custrecord_hyc_ups_endpoint' }) || '';
                    var prodClientId = prodRecord.getValue({ fieldId: 'custrecord_hyc_ups_client_id' }) || '';
                    if (prodEndpoint && prodClientId) {
                        productionStatus = 'Configured (' + prodEndpoint + ')';
                    }
                } catch (e) {
                    productionStatus = 'Error: ' + e.message;
                }

                var statusHtml = '<div style="margin-bottom: 20px; padding: 10px; border: 1px solid #ddd; background-color: #f5f5f5;">';
                statusHtml += '<h4 style="margin-top: 0;">Configuration Status</h4>';
                statusHtml += '<p><strong>Sandbox:</strong> ' + sandboxStatus + '</p>';
                statusHtml += '<p><strong>Production:</strong> ' + productionStatus + '</p>';
                statusHtml += '</div>';

                var statusField = form.addField({
                    id: 'custpage_config_status',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Configuration Status'
                });
                statusField.defaultValue = statusHtml;

            } catch (e) {
                log.error({
                    title: 'Config Status Error',
                    details: e.message
                });
            }
        }

        /**
         * Process the form submission
         *
         * @param {Object} context - Script context
         */
        function processForm(context) {
            var testMode = context.request.parameters.custpage_test_mode === 'T';
            var testType = context.request.parameters.custpage_test_type;
            var salesOrderId = context.request.parameters.custpage_sales_order_id;
            var fulfillmentId = context.request.parameters.custpage_fulfillment_id;
            var saveLabels = context.request.parameters.custpage_save_labels === 'T';

            var results = '';

            try {
                // Set test mode
                upsHelper.setTestMode(testMode);
                results += 'Test Mode: ' + (testMode ? 'SANDBOX' : 'PRODUCTION') + '\n';
                results += 'Save Labels: ' + (saveLabels ? 'YES' : 'NO') + '\n\n';

                switch (testType) {
                    case 'token':
                        results += testTokenRefresh();
                        break;
                    case 'address':
                        results += testAddressValidation(salesOrderId);
                        break;
                    case 'rate':
                        results += testRateQuote(salesOrderId);
                        break;
                    case 'shipment':
                        results += testShipmentCreation(fulfillmentId, saveLabels);
                        break;
                    default:
                        results += 'Please select a test type.';
                }

            } catch (e) {
                results += 'ERROR: ' + e.message + '\n\nStack: ' + e.stack;
            }

            // Write results directly to page (avoids URL length issues with redirect)
            var html = '<!DOCTYPE html><html><head><title>UPS Test Results</title>';
            html += '<style>body { font-family: Arial, sans-serif; padding: 20px; } ';
            html += 'pre { background-color: #f5f5f5; padding: 15px; border: 1px solid #ddd; white-space: pre-wrap; word-wrap: break-word; } ';
            html += '.back-link { margin-bottom: 20px; display: block; }</style></head><body>';
            html += '<a class="back-link" href="javascript:history.back();">&larr; Back to Test Form</a>';
            html += '<h2>UPS Integration Test Results</h2>';
            html += '<pre>' + results.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
            html += '</body></html>';

            context.response.write(html);
        }

        /**
         * Test OAuth token refresh
         *
         * @returns {string} Test results
         */
        function testTokenRefresh() {
            var results = '=== OAuth Token Refresh Test ===\n\n';

            try {
                var tokenRecord = upsHelper.getTokenRecord();
                var accessToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_access_token' });
                var expiration = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_expiration' });

                results += 'SUCCESS: Token retrieved successfully\n';
                results += 'Token (first 20 chars): ' + (accessToken ? accessToken.substring(0, 20) + '...' : 'N/A') + '\n';
                results += 'Expiration: ' + expiration + '\n';
                results += '\nAPI URL: ' + upsHelper.getApiUrl() + '\n';

            } catch (e) {
                results += 'FAILED: ' + e.message + '\n';
            }

            return results;
        }

        /**
         * Test address validation
         *
         * @param {string} salesOrderId - Sales Order internal ID
         * @returns {string} Test results
         */
        function testAddressValidation(salesOrderId) {
            var results = '=== Address Validation Test ===\n\n';

            if (!salesOrderId) {
                return results + 'ERROR: Please provide a Sales Order Internal ID\n';
            }

            try {
                var salesOrderRecord = record.load({
                    type: record.Type.SALES_ORDER,
                    id: salesOrderId
                });

                results += 'Sales Order: ' + salesOrderRecord.getValue({ fieldId: 'tranid' }) + ' (ID: ' + salesOrderId + ')\n\n';

                // Build payload
                var payload = upsAddressValidation.buildAddressValidationPayload(salesOrderRecord);
                results += 'Request Payload:\n' + JSON.stringify(payload, null, 2) + '\n\n';

                // Call API
                var validationResult = upsAddressValidation.validateAddress(salesOrderRecord);

                results += 'SUCCESS: Address validated\n';
                results += 'Classification: ' + validationResult.classification + '\n\n';

                // Truncate API response to avoid URL length issues
                var apiResponseStr = JSON.stringify(validationResult.apiResponse, null, 2);
                if (apiResponseStr.length > 2000) {
                    apiResponseStr = apiResponseStr.substring(0, 2000) + '\n... (truncated)';
                }
                results += 'API Response:\n' + apiResponseStr + '\n';

            } catch (e) {
                results += 'FAILED: ' + e.message + '\n';
                if (e.apiResponse) {
                    var errorResponseStr = JSON.stringify(e.apiResponse, null, 2);
                    if (errorResponseStr.length > 1000) {
                        errorResponseStr = errorResponseStr.substring(0, 1000) + '\n... (truncated)';
                    }
                    results += '\nAPI Response:\n' + errorResponseStr + '\n';
                }
            }

            return results;
        }

        /**
         * Test rate quote
         *
         * @param {string} salesOrderId - Sales Order internal ID
         * @returns {string} Test results
         */
        function testRateQuote(salesOrderId) {
            var results = '=== Rate Quote Test ===\n\n';

            if (!salesOrderId) {
                return results + 'ERROR: Please provide a Sales Order Internal ID\n';
            }

            try {
                var salesOrderRecord = record.load({
                    type: record.Type.SALES_ORDER,
                    id: salesOrderId
                });

                results += 'Sales Order: ' + salesOrderRecord.getValue({ fieldId: 'tranid' }) + ' (ID: ' + salesOrderId + ')\n';
                results += 'Ship Method: ' + salesOrderRecord.getText({ fieldId: 'shipmethod' }) + '\n\n';

                // Call API
                var rateResult = upsRateQuote.getRateQuote(salesOrderRecord);

                results += 'SUCCESS: Rate quote retrieved\n';
                results += 'Rate: $' + rateResult.rate + '\n\n';

                // Truncate API response to avoid URL length issues
                var apiResponseStr = JSON.stringify(rateResult.apiResponse, null, 2);
                if (apiResponseStr.length > 2000) {
                    apiResponseStr = apiResponseStr.substring(0, 2000) + '\n... (truncated)';
                }
                results += 'API Response:\n' + apiResponseStr + '\n';

            } catch (e) {
                results += 'FAILED: ' + e.message + '\n';
                if (e.apiResponse) {
                    var errorResponseStr = JSON.stringify(e.apiResponse, null, 2);
                    if (errorResponseStr.length > 1000) {
                        errorResponseStr = errorResponseStr.substring(0, 1000) + '\n... (truncated)';
                    }
                    results += '\nAPI Response:\n' + errorResponseStr + '\n';
                }
            }

            return results;
        }

        /**
         * Test shipment creation - actually creates a shipment in UPS sandbox
         *
         * @param {string} fulfillmentId - Item Fulfillment internal ID
         * @param {boolean} saveLabels - Whether to save labels to file cabinet
         * @returns {string} Test results
         */
        function testShipmentCreation(fulfillmentId, saveLabels) {
            var results = '=== Shipment Creation Test ===\n\n';

            if (!fulfillmentId) {
                return results + 'ERROR: Please provide an Item Fulfillment Internal ID\n';
            }

            try {
                var fulfillmentRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId
                });

                var tranId = fulfillmentRecord.getValue({ fieldId: 'tranid' });
                results += 'Item Fulfillment: ' + tranId + ' (ID: ' + fulfillmentId + ')\n';
                results += 'Ship Method: ' + fulfillmentRecord.getText({ fieldId: 'shipmethod' }) + '\n\n';

                // Preview shipper and recipient info
                var mappingRecord = upsHelper.getShippingLabelMapping(fulfillmentRecord);
                var shipperInfo = upsHelper.buildShipperInfo(fulfillmentRecord, mappingRecord);
                var recipientInfo = upsHelper.buildRecipientInfo(fulfillmentRecord);

                results += 'Shipper: ' + shipperInfo.Name + ' - ' + (shipperInfo.Address ? shipperInfo.Address.City + ', ' + shipperInfo.Address.StateProvinceCode : 'N/A') + '\n';
                results += 'Recipient: ' + recipientInfo.Name + ' - ' + (recipientInfo.Address ? recipientInfo.Address.City + ', ' + recipientInfo.Address.StateProvinceCode : 'N/A') + '\n\n';

                // Get package info
                var packageCount = fulfillmentRecord.getLineCount({ sublistId: 'package' });
                results += 'Package Count: ' + packageCount + '\n\n';

                // Actually create the shipment (testMode=true means don't update the fulfillment record)
                results += 'Creating shipment in UPS sandbox...\n\n';
                var shipmentResult = upsHelper.createShipment(fulfillmentRecord, true);

                if (shipmentResult.success) {
                    results += 'SUCCESS: Shipment created!\n';
                    results += 'Tracking Number: ' + shipmentResult.trackingNumber + '\n';
                    results += 'Execution Time: ' + shipmentResult.executionTime + 'ms\n\n';

                    // Save labels to file cabinet if checkbox is checked
                    if (saveLabels && shipmentResult.apiResponse) {
                        results += '--- Saving Labels to File Cabinet ---\n';
                        try {
                            var shipmentResults = shipmentResult.apiResponse.ShipmentResponse.ShipmentResults;
                            var pkgResults = shipmentResults.PackageResults;
                            if (!Array.isArray(pkgResults)) {
                                pkgResults = [pkgResults];
                            }

                            for (var i = 0; i < pkgResults.length; i++) {
                                var pkg = pkgResults[i];
                                if (pkg.ShippingLabel && pkg.ShippingLabel.GraphicImage) {
                                    var labelUrl = upsHelper.saveUPSLabel(
                                        pkg.ShippingLabel.GraphicImage,  // base64Data
                                        tranId,                           // tranId for filename
                                        i + 1,                            // packageSequenceNumber
                                        'ZPL'                             // labelFormat
                                    );
                                    results += 'Package ' + (i + 1) + ' Label saved: ' + (labelUrl || 'Error saving') + '\n';
                                } else {
                                    results += 'Package ' + (i + 1) + ': No label data found\n';
                                }
                            }
                            results += '\n';
                        } catch (labelError) {
                            results += 'Error saving labels: ' + labelError.message + '\n\n';
                        }
                    }

                    // Truncate API response for display
                    if (shipmentResult.apiResponse) {
                        var apiResponseStr = JSON.stringify(shipmentResult.apiResponse, null, 2);
                        if (apiResponseStr.length > 2000) {
                            apiResponseStr = apiResponseStr.substring(0, 2000) + '\n... (truncated)';
                        }
                        results += 'API Response:\n' + apiResponseStr + '\n';
                    }
                } else {
                    results += 'FAILED: ' + shipmentResult.message + '\n';
                }

            } catch (e) {
                results += 'FAILED: ' + e.message + '\n';
                if (e.stack) {
                    results += '\nStack: ' + e.stack + '\n';
                }
            }

            return results;
        }

        return {
            onRequest: onRequest
        };
    }
);
