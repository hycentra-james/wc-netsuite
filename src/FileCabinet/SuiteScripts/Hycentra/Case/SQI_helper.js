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
                        ['datecreated', search.Operator.ONORAFTER, 'daysago730'], // Only look for orders with 180 days to improve performance
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
                    // Source the issue item from the Item Fulfillment record
                    var issueItemId = getMemberItemWithMatchingCategory(itemId);

                    // If the Kit member is found, we'll use the kit member item as the issue item
                    if (issueItemId) {
                        currentRecord.setValue({
                            fieldId: 'custrecord_hyc_sqi_issue_item',
                            value: issueItemId
                        });
                    } else {
                        currentRecord.setValue({
                            fieldId: 'custrecord_hyc_sqi_issue_item',
                            value: itemId
                        });
                    }
                    populateItemInfo(orderId, itemId, issueItemId, currentRecord);

                    // Assume we've found the item info, so we'll return
                    return;
                }
            }

            // If there's no item info, we'll reset the item info
            // resetItemInfo(currentRecord, false);
        }

        function populateItemInfo(orderId, itemId, issueItemId, currentRecord) {
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

                        // Lookup the Item unit cost from PO line item
                        var lookupItemId = issueItemId || itemId; // Use issueItemId if available, otherwise use itemId
                        var unitCost = getItemUnitCostFromPO(poNumberLookup, lookupItemId);
                        
                        if (unitCost !== null) {
                            log.debug('populateItemInfo', 'Found unit cost: ' + unitCost + ' for item: ' + lookupItemId);
                            currentRecord.setValue({
                                fieldId: 'custrecord_hyc_sqi_issue_item_unit_cost',
                                value: unitCost
                            });
                        } else {
                            log.debug('populateItemInfo', 'No unit cost found for item: ' + lookupItemId + ' in PO: ' + poNumberLookup);
                        }
                    }

                    // Assume we've found the item info, so we'll return
                    return;
                }
            } catch (e) {
                log.error('Error', e.message);
            }

            // If there's no item info, we'll reset the item info
            // resetItemInfo(currentRecord, true);
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

        function getItemUnitCostFromPO(poNumber, itemId) {
            try {
                if (!poNumber || !itemId) {
                    log.debug('getItemUnitCostFromPO', 'Missing PO number or item ID');
                    return null;
                }

                // Search for the Purchase Order line items
                var poLineSearch = search.create({
                    type: search.Type.PURCHASE_ORDER,
                    filters: [
                        ['type', search.Operator.ANYOF, 'PurchOrd'],
                        'and',
                        ['tranid', search.Operator.IS, poNumber],
                        'and',
                        ['item', search.Operator.ANYOF, itemId],
                        'and',
                        ['mainline', search.Operator.IS, 'F'], // Line level records only
                        'and',
                        ['taxline', search.Operator.IS, 'F'] // Exclude tax lines
                    ],
                    columns: [
                        'item',
                        'rate', // Unit cost
                        'amount',
                        'quantity'
                    ]
                });

                var poLineResults = poLineSearch.run().getRange({ start: 0, end: 1 });

                if (poLineResults && poLineResults.length > 0) {
                    var unitCost = poLineResults[0].getValue({ name: 'rate' });
                    log.debug('getItemUnitCostFromPO', 'Found unit cost: ' + unitCost + ' for item: ' + itemId + ' in PO: ' + poNumber);
                    return parseFloat(unitCost) || 0;
                } else {
                    log.debug('getItemUnitCostFromPO', 'No line item found for item: ' + itemId + ' in PO: ' + poNumber);
                    return null;
                }

            } catch (e) {
                log.error('getItemUnitCostFromPO Error', e.message);
                return null;
            }
        }

        function getMemberItemWithMatchingCategory(kitItemId) {
            try {
                if (!kitItemId) {
                    log.debug('getMemberItemWithMatchingCategory', 'No kit item ID provided');
                    return null;
                }

                // First, get the kit item's product category (class)
                var kitItemRecord = record.load({
                    type: record.Type.KIT_ITEM,
                    id: kitItemId,
                    isDynamic: false
                });

                var kitProductCategory = kitItemRecord.getValue({ fieldId: 'class' });
                log.debug('getMemberItemWithMatchingCategory', 'Kit product category: ' + kitProductCategory);

                if (!kitProductCategory) {
                    log.debug('getMemberItemWithMatchingCategory', 'Kit item has no product category');
                    return null;
                }

                // Get the number of member items in the kit
                var memberItemCount = kitItemRecord.getLineCount({ sublistId: 'member' });
                log.debug('getMemberItemWithMatchingCategory', 'Member item count: ' + memberItemCount);

                // Loop through all member items
                for (var i = 0; i < memberItemCount; i++) {
                    var memberItemId = kitItemRecord.getSublistValue({
                        sublistId: 'member',
                        fieldId: 'item',
                        line: i
                    });

                    if (memberItemId) {
                        // Load the member item to get its product category
                        try {
                            var memberItemRecord = record.load({
                                type: record.Type.INVENTORY_ITEM, // Assuming most members are inventory items
                                id: memberItemId,
                                isDynamic: false
                            });

                            var memberProductCategory = memberItemRecord.getValue({ fieldId: 'class' });
                            log.debug('getMemberItemWithMatchingCategory', 'Member item ' + memberItemId + ' category: ' + memberProductCategory);

                            // Check if the member item's category matches the kit's category
                            if (memberProductCategory && memberProductCategory == kitProductCategory) {
                                log.debug('getMemberItemWithMatchingCategory', 'Found matching member item: ' + memberItemId);
                                return memberItemId;
                            }
                        } catch (memberLoadError) {
                            // If loading as INVENTORY_ITEM fails, try other item types
                            try {
                                var memberItemRecord = record.load({
                                    type: record.Type.NON_INVENTORY_ITEM,
                                    id: memberItemId,
                                    isDynamic: false
                                });

                                var memberProductCategory = memberItemRecord.getValue({ fieldId: 'class' });
                                log.debug('getMemberItemWithMatchingCategory', 'Member item (non-inv) ' + memberItemId + ' category: ' + memberProductCategory);

                                if (memberProductCategory && memberProductCategory == kitProductCategory) {
                                    log.debug('getMemberItemWithMatchingCategory', 'Found matching member item: ' + memberItemId);
                                    return memberItemId;
                                }
                            } catch (secondLoadError) {
                                log.debug('getMemberItemWithMatchingCategory', 'Could not load member item ' + memberItemId + ': ' + secondLoadError.message);
                            }
                        }
                    }
                }

                log.debug('getMemberItemWithMatchingCategory', 'No matching member item found');
                return null;

            } catch (e) {
                log.error('getMemberItemWithMatchingCategory Error', e.message);
                return null;
            }
        }

        return {
            populateOrder: populateOrder,
            searchSalesOrder: searchSalesOrder,
            tryPopulateSingleItemOrder: tryPopulateSingleItemOrder,
            populateItemInfo: populateItemInfo,
            resetItemInfo: resetItemInfo,
            getMemberItemWithMatchingCategory: getMemberItemWithMatchingCategory,
            getItemUnitCostFromPO: getItemUnitCostFromPO
        }
    }
);