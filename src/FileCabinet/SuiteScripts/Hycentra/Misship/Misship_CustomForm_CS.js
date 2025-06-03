/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */
define(['N/record', 'N/search', 'N/log', 'N/format', '../moment.min.js'],
    function (record, search, log, format, moment) {

        var pageMode;

        function pageInit(context) {
            var currentRecord = context.currentRecord;

            // Specify the field ID of the field you want to disable
            var fieldId = 'custrecord_hyc_misship_sopono_search';

            pageMode = context.mode;

            currentRecord.getField({
                fieldId: fieldId
            }).isDisabled = (pageMode !== 'create');
        }


        function fieldChanged(context) {
            var currentRecord = context.currentRecord;

            // Check if the field changed is the reference field you're interested in
            if (context.fieldId === 'custrecord_hyc_misship_sopono_search') {
                var lookupVal = currentRecord.getValue({
                    fieldId: 'custrecord_hyc_misship_sopono_search'
                });

                // Populate the order from Order Ref or Sales Order No
                if (lookupVal && lookupVal !== null && pageMode === 'create') {
                    populateOrder(lookupVal, currentRecord);
                }
            }
        }

        function populateOrder(lookupVal, currentRecord) {
            try {
                // Create a search to find the Sales Order by otherrefnum
                var salesOrderSearch = search.create({
                    type: search.Type.SALES_ORDER,
                    filters: [
                        ['mainline', search.Operator.IS, 'T'],
                        'and',
                        [
                            ['tranid', search.Operator.IS, lookupVal],
                            'or',
                            ['otherrefnum', search.Operator.EQUALTO, lookupVal]
                        ],
                        'and',
                        ['datecreated', search.Operator.ONORAFTER, 'daysago400'], // Only look for orders with 180 days to improve performance
                    ],
                    columns: ['internalid',
                        'otherrefnum', // PO Number
                        'shipdate', // Ship Date
                        'entity', // Customer
                        'custbody_fmt_order_ship_type', // Ship Type
                        'total' // Total
                    ]
                });

                var soRS = salesOrderSearch.run().getRange({ start: 0, end: 1 });

                if (soRS.length > 0) {
                    var soInternalId = soRS[0].getValue({ name: 'internalid' });
                    var existingSOInternalId = currentRecord.getValue({
                        fieldId: 'custrecord_hyc_misship_so'
                    });

                    // if SO has changed during search, we'll clear the line item
                    if (lookupVal != existingSOInternalId) {
                        removeItemRecords(currentRecord);
                    }

                    // Set the Sales Order field on the Mis-ship record
                    currentRecord.setValue({
                        fieldId: 'custrecord_hyc_misship_so',
                        value: soInternalId
                    });

                    // Look up the ship date from Item Fulfillment
                    var itemFulfillmentSearch = search.create({
                        type: search.Type.ITEM_FULFILLMENT,
                        filters: [
                            ['createdfrom', search.Operator.IS, soInternalId] // Filter by Sales Order internal ID
                        ],
                        columns: [
                            'trandate', // Ship Date
                            'custbody_hyc_wh_associate' // Warehouse associate
                        ]
                    });

                    // Set PO Number
                    currentRecord.setValue({
                        fieldId: 'custrecord_hyc_misship_po_no',
                        value: soRS[0].getValue({ name: 'otherrefnum' })
                    });

                    // Set the Ship Date
                    var ifRS = itemFulfillmentSearch.run().getRange({ start: 0, end: 1 });
                    if (ifRS.length > 0) {
                        currentRecord.setValue({
                            fieldId: 'custrecord_hyc_misship_shipdate',
                            value: new Date(moment(ifRS[0].getValue({ name: 'trandate' })).format('M/D/YYYY'))
                        });

                        currentRecord.setValue({
                            fieldId: 'custrecord_hyc_misship_warehouse_asso',
                            value: ifRS[0].getValue({ name: 'custbody_hyc_wh_associate' })
                        });
                    }

                    // Set Customer
                    currentRecord.setValue({
                        fieldId: 'custrecord_hyc_misship_customer',
                        value: soRS[0].getValue({ name: 'entity' })
                    });

                    // Set Invoice Total
                    currentRecord.setValue({
                        fieldId: 'custrecord_hyc_misship_ori_invoice_amt',
                        value: soRS[0].getValue({ name: 'total' })
                    });

                    // Populate Order Items & Parts
                    populateOrderItems(currentRecord, soInternalId);
                } else {
                    alert('No Sales Order found for reference: ' + lookupVal);
                    log.error('Sales Order not found', 'No Sales Order found for reference: ' + lookupVal);
                }

                function populateOrderItems(currentRecord, soInternalId) {
                    var itemLineSearch = search.create({
                        type: search.Type.SALES_ORDER,
                        filters: [
                            ['internalid', search.Operator.IS, soInternalId], // Filter by Sales Order internal ID
                            'and',
                            ['mainline', search.Operator.IS, 'F'], // Filter out mainline to get item lines
                            'and',
                            ['item.type', search.Operator.ANYOF, 'InvtPart', 'Kit']
                        ],
                        columns: [
                            'item', // Item ID
                            'quantity', // Quantity
                            'rate', // Rate
                            'custcol_fmt_ship_type', // Ship Type
                            // Add more columns as needed
                        ]
                    });

                    // Run the search and retrieve the results
                    var itemLineRS = itemLineSearch.run().getRange({
                        start: 0,
                        end: 100 // Adjust as needed based on your requirements
                    });

                    // Get the number of lines in the sublist
                    var lineCount = currentRecord.getLineCount({
                        sublistId: 'recmachcustrecord_hyc_misship_item_parent'
                    });

                    // Only append items from orders when there's no item record in the Mis-Ship record
                    if (lineCount == 0) {
                        // Process the search results
                        for (var i = 0; i < itemLineRS.length; i++) {
                            var itemId = itemLineRS[i].getValue('item');
                            var quantity = itemLineRS[i].getValue('quantity');
                            var rate = itemLineRS[i].getValue('rate');
                            var shipType = itemLineRS[i].getValue('custcol_fmt_ship_type');

                            currentRecord.selectNewLine({
                                sublistId: 'recmachcustrecord_hyc_misship_item_parent'
                            });

                            // Set the Item
                            setItemSublistField(currentRecord, 'recmachcustrecord_hyc_misship_item_parent', 'custrecord_hyc_misship_item_ordered_item', itemId);

                            // Set the Quantity
                            setItemSublistField(currentRecord, 'recmachcustrecord_hyc_misship_item_parent', 'custrecord_hyc_misship_item_ordered_qty', quantity);

                            // Set the Rate
                            setItemSublistField(currentRecord, 'recmachcustrecord_hyc_misship_item_parent', 'custrecord_hyc_misship_item_price', rate);

                            // Set Ship Type
                            setItemSublistField(currentRecord, 'recmachcustrecord_hyc_misship_item_parent', 'custrecord_hyc_misship_item_shiptype', shipType);

                            // Set Record Level Ship Type
                            currentRecord.setValue({
                                fieldId: 'custrecord_hyc_misship_ship_type',
                                value: shipType
                            });
                            currentRecord.commitLine({ sublistId: 'recmachcustrecord_hyc_misship_item_parent' });

                            // Process or log the information as needed
                            log.debug('Item Line Info', 'Item ID: ' + itemId + ', Quantity: ' + quantity + ', Rate: ' + rate);
                            //alert('Item ID: ' + itemId + ', Quantity: ' + quantity + ', Rate: ' + rate);
                            populateItemParts(currentRecord, itemId);

                        }
                    }
                }

                function populateItemParts(currentRecord, itemId) {
                    var kitItemSearch = search.create({
                        type: search.Type.KIT_ITEM,
                        filters: [
                            ['internalid', search.Operator.IS, itemId]
                        ],
                        columns: [
                            'memberitem',
                            'memberquantity'
                            // Add other columns as needed
                        ]
                    });

                    var kitMembersRS = kitItemSearch.run().getRange({ start: 0, end: 50 });

                    // Add all member items to the Mis-shipped Item Parts sublist
                    for (var j = 0; j < kitMembersRS.length; j++) {
                        var memberItem = kitMembersRS[j].getValue('memberitem');
                        var memberQuantity = kitMembersRS[j].getValue('memberquantity');

                        currentRecord.selectNewLine({
                            sublistId: 'recmachcustrecord_hyc_misship_part_parent'
                        });

                        // Set the Item
                        setItemSublistField(currentRecord, 'recmachcustrecord_hyc_misship_part_parent', 'custrecord_hyc_misship_item_ordered_part', memberItem);

                        // Set the Quantity
                        setItemSublistField(currentRecord, 'recmachcustrecord_hyc_misship_part_parent', 'custrecord_hyc_misship_part_ordered_qty', memberQuantity);

                        currentRecord.commitLine({ sublistId: 'recmachcustrecord_hyc_misship_part_parent' });
                    }
                }
            } catch (e) {
                log.error('Error', e.message);
            }
        }

        return {
            fieldChanged: fieldChanged,
            pageInit: pageInit
        };


        function setItemSublistField(currentRecord, sublistId, fieldId, value) {
            currentRecord.setCurrentSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                value: value,
                forceSyncSourcing: true
            });
        }

        function removeItemRecords(currentRecord) {
            // Specify the sublist ID
            var sublistId = 'recmachcustrecord_hyc_misship_item_parent'; // Replace with your sublist ID

            // Get the number of lines in the sublist
            var lineCount = currentRecord.getLineCount({
                sublistId: sublistId
            });

            // Loop through each line and remove it
            for (var i = lineCount - 1; i >= 0; i--) {
                currentRecord.removeLine({
                    sublistId: sublistId,
                    line: i
                });
            }
        }

    });
