/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/record', 'N/search', 'N/https', 'N/log', 'N/ui/serverWidget', './maerskHelper'], 
    function (record, search, https, log, serverWidget, helper) {

        /**
         * Function to make API call, retrieve JSON response, and display as a table.
         * @param {Object} context - Suitelet context
         */
        function onRequest(context) {
            if (context.request.method === 'GET') {
                // Create the Suitelet form
                var form = serverWidget.createForm({
                    title: 'Maersk tracking'
                });

                // Add a text field to the form
                var txtLoadId = form.addField({
                    id: 'custpage_load_id',
                    type: serverWidget.FieldType.TEXT,
                    label: 'Load ID:'
                });

                /*
                // Add a text field to the form
                var txtPONum = form.addField({
                    id: 'custpage_po_num',
                    type: serverWidget.FieldType.TEXT,
                    label: 'PO Number:'
                });
                */
                // Add a submit button
                form.addSubmitButton({
                    label: 'Submit'
                });

                // Display the form
                context.response.writePage(form);
            } else if (context.request.method === 'POST') {
                try {
                    var lineCount = 0;
                    
                    // Create Suitelet form
                    var form = serverWidget.createForm({
                        title: 'Maersk Load List'
                    });
    
                    // Add status options to the dropdown
                    // var statusOptions = ['Quoted', 'Booked', 'Dispatched', 'Loading', 'InTransit', 'OutForDelivery', 'Refused', 'MissedDelivery', 'LoadingUnloading', 'Unloading', 'Delivered', 'OSD', 'CanceledWithCharges', 'Canceled'];
    
                    // Add a sublist to display JSON responses
                    var sublist = form.addSublist({
                        id: 'custpage_api_response_sublist',
                        type: serverWidget.SublistType.LIST,
                        label: 'Load List'
                    });
    
                    // Add columns to the sublist
                    sublist.addField({
                        id: 'custpage_pickup_date',
                        label: 'Pickup Date',
                        type: serverWidget.FieldType.TEXT
                    });

                    sublist.addField({
                        id: 'custpage_estimated_delivery',
                        label: 'ETA',
                        type: serverWidget.FieldType.TEXT
                    });

                    // Add columns to the sublist
                    sublist.addField({
                        id: 'custpage_last_update',
                        label: 'Last Update',
                        type: serverWidget.FieldType.TEXT
                    });
    
                    sublist.addField({
                        id: 'custpage_po_reference',
                        label: 'PO Reference',
                        type: serverWidget.FieldType.TEXT
                    });
    
                    sublist.addField({
                        id: 'custpage_load_id',
                        label: 'Load ID',
                        type: serverWidget.FieldType.TEXT
                    });
    
                    sublist.addField({
                        id: 'custpage_shipment_status',
                        label: 'Status',
                        type: serverWidget.FieldType.TEXT
                    });
    
                    sublist.addField({
                        id: 'custpage_shipment_status_desc',
                        label: 'Status Desc',
                        type: serverWidget.FieldType.TEXT
                    });
    
                     // Create a search to find Item Fulfillment records
                     var itemFulfillmentSearch = search.create({
                        type: search.Type.ITEM_FULFILLMENT,
                        columns: ['tranid', 'custbody_hyc_maersk_load_id'],
                        filters: [
                            search.createFilter({
                                name: 'custbody_hyc_maersk_load_id',
                                operator: search.Operator.ISNOTEMPTY
                            }),
                            search.createFilter({
                                name: 'mainline',
                                operator: search.Operator.IS,
                                values: ['T']
                            })
                        ]
                    });
    
                    // Execute the search
                    //var searchResults = itemFulfillmentSearch.run().getRange({ start: 0, end: 1000 });
    
                    // Log the results
                    // for (var i = 0; i < searchResults.length; i++) {
                        // var tranId = searchResults[i].getValue('tranid');
                        // var maerskLoadId = searchResults[i].getValue('custbody_hyc_maersk_load_id');
                        // Process the submitted data
                        var maerskLoadId = context.request.parameters.custpage_load_id;
                        
                        /*
                        var poNo = context.request.parameters.custpage_po_num;

                        if (poNo && poNo !== null && poNo !== '') {
                            log.debug('DEBUG', 'poNumber = ' + poNo);
                            maerskLoadId = getLoadIdFromPONum(poNo);
                        }
                        */

                        if (maerskLoadId && maerskLoadId !== null && maerskLoadId !== '') {
                            log.debug('DEBUG', 'maerskLoadId = ' + maerskLoadId);

                            //var status = statusOptions[i];
                            var apiResponse = makeApiCall(maerskLoadId);
        
                            // Parse and append JSON response to the sublist
                            var parsedResponse = JSON.parse(apiResponse);
                            for (var j = 0; j < parsedResponse.length; j++) {
                                try {
                                    sublist.setSublistValue({
                                        id: 'custpage_pickup_date',
                                        line: lineCount,
                                        value: parsedResponse[j].pickupDate
                                    }); 
                                    sublist.setSublistValue({
                                        id: 'custpage_estimated_delivery',
                                        line: lineCount,
                                        value: parsedResponse[j].estimatedDeliveryDate
                                    }); 
                                    sublist.setSublistValue({
                                        id: 'custpage_last_update',
                                        line: lineCount,
                                        value: parsedResponse[j].lastUpdateDate
                                    });                                    
                                    sublist.setSublistValue({
                                        id: 'custpage_po_reference',
                                        line: lineCount,
                                        value: parsedResponse[j].poReference
                                    });
                                    sublist.setSublistValue({
                                        id: 'custpage_load_id',
                                        line: lineCount,
                                        value: parsedResponse[j].loadId
                                    });
                                    sublist.setSublistValue({
                                        id: 'custpage_shipment_status',
                                        line: lineCount,
                                        value: parsedResponse[j].status
                                    });
        
                                    sublist.setSublistValue({
                                        id: 'custpage_shipment_status_desc',
                                        line: lineCount,
                                        value: parsedResponse[j].statusDescription
                                    });
        
                                    lineCount++;
                                } catch (e) {
                                    log.error('ERROR', e);
                                }
                            }
                        }
                    // }
    
                    // Display the form
                    context.response.writePage(form);
                } catch (e) {
                    // Log any errors that occur during script execution
                    log.error({
                        title: 'Error',
                        details: e.toString()
                    });
                }
            }
        }

        function getLoadIdFromPONum(poNo) {
            // Replace 'custbody_otherrefnum' with the internal ID of your custom field
            var customFieldId = 'otherrefnum';

            // Replace 'salesorder' with the record type of your Sales Order
            var salesOrderRecordType = 'salesorder';

            // Replace 'itemfulfillment' with the record type of your Item Fulfillment
            var itemFulfillmentRecordType = 'itemfulfillment';

            var maerskLoadId = null;

            // Create a search to find the Sales Order record
            var salesOrderSearch = search.create({
                type: record.Type.SALES_ORDER,
                filters: [search.createFilter({
                    name: customFieldId,
                    operator: search.Operator.IS,
                    values: poNo
                })],
                columns: ['internalid']
            });

            // Execute the search and check if a Sales Order is found
            var salesOrderId = null;
            salesOrderSearch.run().each(function(result) {
                salesOrderId = result.getValue({ name: 'internalid' });
                return false; // Stop the search after the first result
            });

            if (salesOrderId) {
                // If Sales Order is found, create a search for related Item Fulfillments
                log.debug('DEBUG', 'salesOrderId = ' + salesOrderId);
                var itemFulfillmentSearch = search.create({
                    type: record.Type.ITEM_FULFILLMENT,
                    filters: [search.createFilter({
                        name: 'createdfrom',
                        operator: search.Operator.IS,
                        values: salesOrderId
                    })],
                    columns: ['custbody_hyc_maersk_load_id']
                });

                // Execute the search and log the results
                
                itemFulfillmentSearch.run().each(function(result) {
                    log.debug('DEBUG', 'AAA');
                    maerskLoadId = result.getValue(itemFulfillmentSearch.columns);
                });

                log.debug('DEBUG', 'from PONum maerskLoadId = ' + maerskLoadId);
            } else {
                // If Sales Order is not found, respond accordingly
                context.response.write('Sales Order not found for otherrefnum: ' + poNo);
            }

            return maerskLoadId;
        }

        /**
         * Function to make an API call.
         * @param {string} status - Shipment status to filter by
         * @returns {string} - JSON response from the API
         */
        function makeApiCall(loadId) {
            var tokenRecord = helper.getTokenRecord();
            var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_oauth_access_token' });
            var apiEndpoint = tokenRecord.getValue({ fieldId: 'custrecord_hyc_oauth_endpoint' }) + 'api/v1/tracking?loadid=' + loadId;

            log.debug('DEBUG', 'apiEndpoint = ' + apiEndpoint);

            // Make the API request
            var response = https.get({
                url: apiEndpoint,
                headers: {
                    'Authorization': 'Bearer ' + bearerToken,
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                }
            });

            log.debug('DEBUG', 'apiEndpoint = ' + apiEndpoint);
            log.debug('DEBUG', 'response.code = ' + response.code);
            //log.debug('DEBUG', 'response.body = ' + response.body);

            // Return the JSON response
            return response.body;
        }

        // Expose the onRequest function for the Suitelet
        return {
            onRequest: onRequest
        };

});