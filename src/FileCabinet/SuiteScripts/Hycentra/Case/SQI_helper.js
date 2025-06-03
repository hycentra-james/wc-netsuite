/*
 * SQI_helper.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
*/

define(['N/record', 'N/log', 'N/search'],
    function (record, log, search) {

        function populateOrder(lookupVal, currentRecord, targetOrderFieldId) {
            try {
                var soRS = searchSalesOrder(lookupVal);
                if (soRS && soRS.length > 0) {
                    currentRecord.setValue({
                        fieldId: targetOrderFieldId,
                        value: soRS[0].getValue({ name: 'internalid' })
                    });
                    currentRecord.setValue({
                        fieldId: 'custrecord_hyc_sqi_cust_purchased_from',
                        value: soRS[0].getValue({ name: 'entity' })
                    });
                } else {
                    log.debug('DEBUG', 'No Sales Order found for reference: ' + lookupVal);
                }
            } catch (e) {
                log.error('DEBUG', 'Unexpected error: ' + e.message);
            }
        }

        function searchSalesOrder(lookupVal) {
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
                            ['otherrefnum', search.Operator.EQUALTO, lookupVal],
                            'or',
                            ['custbody_customer_order_number', search.Operator.IS, lookupVal]
                        ],
                        'and',
                        ['datecreated', search.Operator.ONORAFTER, 'daysago400'], // Only look for orders with 180 days to improve performance
                    ],
                    columns: ['internalid',
                        'tranid', // SO Number
                        'otherrefnum', // PO Number
                        'shipdate', // Ship Date
                        'entity', // Customer
                        'custbody_fmt_order_ship_type', // Ship Type
                        'total', // Total
                        'custbody_fmt_actual_shipping_cost' // Actual Shipping Cost
                    ]
                });

                return salesOrderSearch.run().getRange({ start: 0, end: 1 });
            } catch (e) {
                log.error('Error', e.message);
            }
        }

        function tryPopulateSingleItemOrder(orderId, currentRecord) {
            if (orderId) {
                // Look up the Item Fulfillment record
                var itemFulfillmentSearch = search.create({
                    type: search.Type.ITEM_FULFILLMENT,
                    filters: [
                        ['createdfrom', search.Operator.ANYOF, orderId],
                        'and',
                        ['custcol_fmt_lot_numbers', search.Operator.ISNOTEMPTY, null]
                    ],
                    columns: ['internalid', 'item']
                });

                var itemFulfillmentRS = itemFulfillmentSearch.run().getRange({ start: 0, end: 10 });

                // If Item Fulfillment record exists and only have one item record, we'll auto fill those info
                if (itemFulfillmentRS && itemFulfillmentRS.length == 1) {
                    var itemId = itemFulfillmentRS[0].getValue({ name: 'item' });
                    currentRecord.setValue({
                        fieldId: 'custrecord_hyc_sqi_issue_item',
                        value: itemId
                    });
                    populateItemInfo(orderId, itemId, currentRecord);

                    // Assume we've found the item info, so we'll return
                    return;
                }
            }

            // If there's no item info, we'll reset the item info
            resetItemInfo(currentRecord, false);
        }

        function populateItemInfo(orderId, itemId, currentRecord) {
            try {
                // Look up the Item Fulfillment record
                var itemFulfillmentSearch = search.create({
                    type: search.Type.ITEM_FULFILLMENT,
                    filters: [
                        ['createdfrom', search.Operator.ANYOF, orderId],
                        'and',
                        ['item', search.Operator.ANYOF, itemId]
                    ],
                    columns: ['internalid', 'custcol_fmt_lot_numbers']
                });

                var itemFulfillmentRS = itemFulfillmentSearch.run().getRange({ start: 0, end: 1 });

                if (itemFulfillmentRS && itemFulfillmentRS.length > 0) {
                    var lotNumber = itemFulfillmentRS[0].getValue({ name: 'custcol_fmt_lot_numbers' });

                    if (lotNumber) {
                        // If lot number is not empty, we'll lookup the Purchase Order by lot number
                        var poNumberLookup = "PO" + lotNumber;

                        // Lookup the Purchase Order by poNumberLookup
                        var purchaseOrderSearch = search.create({
                            type: search.Type.PURCHASE_ORDER,
                            filters: [
                                ['tranid', search.Operator.IS, poNumberLookup]
                            ],
                            columns: ['internalid', 'tranid', 'entity']
                        });

                        var purchaseOrderRS = purchaseOrderSearch.run().getRange({ start: 0, end: 1 });

                        if (purchaseOrderRS && purchaseOrderRS.length > 0) {
                            currentRecord.setValue({
                                fieldId: 'custrecord_hyc_sqi_lot_no',
                                value: purchaseOrderRS[0].getValue({ name: 'internalid' })
                            });
                            currentRecord.setValue({
                                fieldId: 'custrecord_hyc_sqi_manufacturer',
                                value: purchaseOrderRS[0].getValue({ name: 'entity' })
                            });
                        }
                    }

                    // Assume we've found the item info, so we'll return
                    return;
                }
            } catch (e) {
                log.error('Error', e.message);
            }

            // If there's no item info, we'll reset the item info
            resetItemInfo(currentRecord, true);
        }

        function resetItemInfo(currentRecord, showAlert) {
            currentRecord.setValue({
                fieldId: 'custrecord_hyc_sqi_issue_item',
                value: null
            });
            currentRecord.setValue({
                fieldId: 'custrecord_hyc_sqi_lot_no',
                value: null
            });
            currentRecord.setValue({
                fieldId: 'custrecord_hyc_sqi_manufacturer',
                value: null
            });

            if (showAlert) {
                alert('Please verify the Issue Item, make sure the Item is in the Item Fulfillment that is linked to the Sales Order');
            }
        }

        return {
            populateOrder: populateOrder,
            searchSalesOrder: searchSalesOrder,
            tryPopulateSingleItemOrder: tryPopulateSingleItemOrder,
            populateItemInfo: populateItemInfo,
            resetItemInfo: resetItemInfo
        }
    }
);