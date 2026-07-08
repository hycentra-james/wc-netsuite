/**
 *@NApiVersion 2.0
 *@NScriptType MapReduceScript
 *@NAmdConfig  ../../FMT Consultants/config.json
 *
 * INVENTORY EVENT DRIVEN VERSION
 * Processes items from inventory-affecting events created in the last hour:
 * - Sales Orders (commits inventory)
 * - Item Fulfillments (decreases on-hand inventory)
 * - Item Receipts from PO (increases on-hand inventory)
 *
 * Also finds and updates kits when their component items are affected.
 * Expected 85-95% performance improvement vs processing all items.
 *
 * WC-549 FOLLOW-UP: the per-item/per-kit next-receipt-date, next-receipt-
 * quantity, and kit-available-quantity CALCULATION logic (findMyReceipts,
 * calcDate, checkforWeekend, processKitInventoryAndReceipts and its helpers,
 * findKitsContainingComponents) has been extracted verbatim into
 * ./lib/NextReceiptCalc.js so the new on-demand ManualNextReceiptSync_SL.js
 * Suitelet can reuse the exact same code path instead of re-implementing it.
 * This is a pure extract-and-require refactor - no calculation logic
 * changed, only relocated. This script's own inputs/outputs are unchanged.
 * The @NAmdConfig above is still required even though this script's own
 * top-level code no longer references `underscore` directly - it's needed
 * transitively because NextReceiptCalc.js's calculateInventoryItemReceiptFields()
 * uses `_.sortBy`, and @NAmdConfig can only be declared by the entry-point
 * script, so it has to stay here for that nested require to resolve.
 */

define(['N/search', 'N/record', 'N/query', 'N/runtime', 'N/error', 'N/format', 'underscore', '../moment.min', './lib/NextReceiptCalc'],
    function (search, record, query, runtime, error, format, _, moment, nextReceiptCalc) {

        function getInputData() {
            try {
                log.audit('Starting Inventory Event Driven Receipt Date Update', 'Looking for SO, IF, and Receipts in last hour');

                // Calculate proper hourly timeframe (e.g., 8:00-9:00, 9:00-10:00)
                // Using moment.js for better date handling in company timezone
                var now = moment();
                var currentHour = now.hour();

                // Create start time at the top of the previous hour
                var startTime = moment().hour(currentHour - 1).minute(0).second(0).millisecond(0);

                // Create end time at the top of current hour
                var endTime = moment().hour(currentHour).minute(0).second(0).millisecond(0);

                // Format dates for NetSuite search filters (M/d/yy h:mm a format)
                var startTimeFormatted = startTime.format('M/D/YY h:mm A');
                var endTimeFormatted = endTime.format('M/D/YY h:mm A');

                log.audit('Time window for inventory events', {
                    'now': now.format('M/D/YYYY h:mm:ss A'),
                    'startTime': startTime.format('M/D/YYYY h:mm:ss A'),
                    'endTime': endTime.format('M/D/YYYY h:mm:ss A'),
                    'startTimeFormatted': startTimeFormatted,
                    'endTimeFormatted': endTimeFormatted,
                    'timezone': 'Company timezone (Pacific Time)'
                });

                // Step 1: Find items from all inventory-affecting events in the last hour
                var salesOrderItems = findSalesOrderItems(startTimeFormatted, endTimeFormatted);
                var fulfillmentItems = findItemFulfillmentItems(startTimeFormatted, endTimeFormatted);
                var receiptItems = findItemReceiptItems(startTimeFormatted, endTimeFormatted);

                log.audit('Items found from inventory events', {
                    'salesOrderItems': salesOrderItems.length,
                    'fulfillmentItems': fulfillmentItems.length,
                    'receiptItems': receiptItems.length
                });

                // Step 2: Merge all unique items from all sources
                var allEventItems = [];
                var processedItems = {};

                // Helper to add unique items
                function addUniqueItems(itemArray) {
                    for (var i = 0; i < itemArray.length; i++) {
                        var itemId = itemArray[i];
                        if (!processedItems[itemId]) {
                            allEventItems.push(itemId);
                            processedItems[itemId] = true;
                        }
                    }
                }

                addUniqueItems(salesOrderItems);
                addUniqueItems(fulfillmentItems);
                addUniqueItems(receiptItems);

                // Step 3: Find kits that contain any of the inventory items from SO/IF/Receipt
                // This ensures kit quantities are updated when their components change
                // NOTE: Sales Orders are included because they commit inventory (reduce locationquantityavailable)
                var inventoryItemsFromEvents = [];
                var allEventSources = [salesOrderItems, fulfillmentItems, receiptItems];
                for (var s = 0; s < allEventSources.length; s++) {
                    for (var i = 0; i < allEventSources[s].length; i++) {
                        if (inventoryItemsFromEvents.indexOf(allEventSources[s][i]) === -1) {
                            inventoryItemsFromEvents.push(allEventSources[s][i]);
                        }
                    }
                }

                var affectedKits = nextReceiptCalc.findKitsContainingComponents(inventoryItemsFromEvents);
                addUniqueItems(affectedKits);

                log.audit('Merged items from all sources', {
                    'totalUniqueItems': allEventItems.length,
                    'affectedKits': affectedKits.length
                });

                // Early exit if no items to process
                if (allEventItems.length === 0) {
                    log.audit('No inventory events found in time window', 'Skipping script execution');
                    return [];
                }

                // Step 4: Expand kit components for any kit items in the list
                var allItemsToProcess = expandKitComponents(allEventItems);

                log.audit('Final items to process (including kit components)', {
                    'totalItems': allItemsToProcess.length,
                    'itemsFromEvents': allEventItems.length
                });

                // Step 5: Create search for these specific items only
                var itemSearch = search.create({
                    type: search.Type.ITEM,
                    filters: [
                        ['internalid', 'anyof', allItemsToProcess],
                        'AND',
                        ['type', 'anyof', ['InvtPart', 'Kit']] // Only inventory and kit items
                    ],
                    columns: [
                        'internalid',
                        'type',
                        'itemid',
                        'custitem_fmt_next_receipt_date',
                        'custitem_fmt_next_receipt_quantity',
                        'custitem_fmt_avail_kit_quantity'
                    ]
                });

                var usage = runtime.getCurrentScript().getRemainingUsage();
                log.audit('Starting script with usage units', usage);

                return itemSearch;

            } catch (e) {
                log.error('Error in getInputData', e);
                throw e;
            }
        }

        function findSalesOrderItems(startTimeFormatted, endTimeFormatted) {
            var itemIds = [];
            var processedItems = {}; // Prevent duplicates
            var uniqueOrders = {}; // Track unique SO numbers

            // Search for sales orders created in the specified time window
            var salesOrderSearch = search.create({
                type: search.Type.SALES_ORDER,
                filters: [
                    ['datecreated', 'within', startTimeFormatted, endTimeFormatted],
                    'AND',
                    ['mainline', 'is', 'F'], // Get line items, not headers
                    'AND',
                    ['shipping', 'is', 'F'], // Exclude shipping lines
                    'AND',
                    ['taxline', 'is', 'F'], // Exclude tax lines
                    'AND',
                    ['item.type', 'anyof', ['InvtPart', 'Kit']] // Only inventory and kit items
                ],
                columns: [
                    'tranid', // Sales order number
                    'item', // Item internal ID
                    search.createColumn({ name: 'type', join: 'item' }), // Item type
                    search.createColumn({ name: 'itemid', join: 'item' }), // Item ID
                    'quantity',
                    'datecreated'
                ]
            });

            var lineCount = 0;

            log.debug('Sales order search filters', {
                'searchType': 'SALES_ORDER',
                'startTimeFormatted': startTimeFormatted,
                'endTimeFormatted': endTimeFormatted,
                'dateFilter': 'datecreated within ' + startTimeFormatted + ' and ' + endTimeFormatted,
                'explanation': 'Using proper hourly windows with M/d/yy h:mm a format'
            });

            salesOrderSearch.run().each(function(result) {
                var soNumber = result.getValue('tranid');
                var itemId = result.getValue('item');
                var itemType = result.getValue({ name: 'type', join: 'item' });
                var itemName = result.getValue({ name: 'itemid', join: 'item' });
                var quantity = result.getValue('quantity');
                var dateCreated = result.getValue('datecreated');

                // Track unique SO numbers
                uniqueOrders[soNumber] = true;

                // Track unique items only
                if (!processedItems[itemId]) {
                    itemIds.push(itemId);
                    processedItems[itemId] = true;

                    log.debug('Found item from sales order', {
                        'salesOrder': soNumber,
                        'itemId': itemId,
                        'itemName': itemName,
                        'itemType': itemType,
                        'quantity': quantity,
                        'dateCreated': dateCreated
                    });
                }

                lineCount++;
                return true;
            });

            var soNumbers = Object.keys(uniqueOrders);
            log.audit('Sales order search completed', {
                'uniqueItems': itemIds.length,
                'totalOrderLines': lineCount,
                'salesOrders': soNumbers.length > 0 ? soNumbers.join(', ') : 'None',
                'orderCount': soNumbers.length
            });

            return itemIds;
        }

        function expandKitComponents(itemIds) {
            if (!itemIds || itemIds.length === 0) {
                return [];
            }

            var allItems = itemIds.slice(); // Start with original items
            var kitComponentIds = [];

            // Process in batches if itemIds is very large to avoid search filter limits
            // NetSuite 'anyof' filters can handle ~1000 IDs safely
            var BATCH_SIZE = 500;
            var totalBatches = Math.ceil(itemIds.length / BATCH_SIZE);

            log.audit('Kit component expansion starting', {
                'totalItems': itemIds.length,
                'batchSize': BATCH_SIZE,
                'batches': totalBatches
            });

            for (var batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                var startIdx = batchIndex * BATCH_SIZE;
                var endIdx = Math.min(startIdx + BATCH_SIZE, itemIds.length);
                var batchItems = itemIds.slice(startIdx, endIdx);

                log.debug('Processing kit batch', {
                    'batchNumber': batchIndex + 1,
                    'totalBatches': totalBatches,
                    'batchSize': batchItems.length
                });

                // Find kit components for any kit items in this batch
                var kitComponentSearch = search.create({
                    type: 'kititem',
                    filters: [
                        ['internalid', 'anyof', batchItems],
                        'AND',
                        ['type', 'anyof', 'Kit']
                    ],
                    columns: [
                        'internalid', // Kit ID
                        search.createColumn({ name: 'internalid', join: 'memberItem' }), // Component ID
                        search.createColumn({ name: 'itemid', join: 'memberItem' }), // Component item ID
                        search.createColumn({ name: 'type', join: 'memberItem' }) // Component type
                    ]
                });

                // Use runPaged to handle searches with > 4000 results
                var pagedData = kitComponentSearch.runPaged({
                    pageSize: 1000 // Maximum page size
                });

                log.debug('Paged search info', {
                    'batchNumber': batchIndex + 1,
                    'pageCount': pagedData.pageRanges.length,
                    'totalResults': pagedData.count
                });

                // Process each page
                pagedData.pageRanges.forEach(function(pageRange) {
                    var currentPage = pagedData.fetch({
                        index: pageRange.index
                    });

                    currentPage.data.forEach(function(result) {
                        var kitId = result.getValue('internalid');
                        var componentId = result.getValue({ name: 'internalid', join: 'memberItem' });
                        var componentItemId = result.getValue({ name: 'itemid', join: 'memberItem' });
                        var componentType = result.getValue({ name: 'type', join: 'memberItem' });

                        if (componentId && allItems.indexOf(componentId) === -1) {
                            allItems.push(componentId);
                            kitComponentIds.push(componentId);

                            // Only log first 10 to avoid log bloat
                            if (kitComponentIds.length <= 10) {
                                log.debug('Added kit component', {
                                    'kitId': kitId,
                                    'componentId': componentId,
                                    'componentItemId': componentItemId,
                                    'componentType': componentType
                                });
                            }
                        }
                    });
                });
            }

            log.audit('Kit component expansion completed', {
                'originalItems': itemIds.length,
                'kitComponents': kitComponentIds.length,
                'totalItems': allItems.length
            });

            return allItems;
        }

        /**
         * Find items from Item Fulfillments created in the specified time window
         * This captures inventory decreases when items are shipped
         */
        function findItemFulfillmentItems(startTimeFormatted, endTimeFormatted) {
            var itemIds = [];
            var processedItems = {};
            var uniqueFulfillments = {}; // Track unique IF numbers

            var fulfillmentSearch = search.create({
                type: search.Type.ITEM_FULFILLMENT,
                filters: [
                    ['datecreated', 'within', startTimeFormatted, endTimeFormatted],
                    'AND',
                    ['mainline', 'is', 'F'],
                    'AND',
                    ['shipping', 'is', 'F'],
                    'AND',
                    ['taxline', 'is', 'F'],
                    'AND',
                    ['item.type', 'anyof', ['InvtPart', 'Kit']]
                ],
                columns: [
                    'tranid',
                    'item',
                    search.createColumn({ name: 'type', join: 'item' }),
                    search.createColumn({ name: 'itemid', join: 'item' }),
                    'quantity',
                    'datecreated'
                ]
            });

            var lineCount = 0;

            fulfillmentSearch.run().each(function(result) {
                var ifNumber = result.getValue('tranid');
                var itemId = result.getValue('item');
                var itemType = result.getValue({ name: 'type', join: 'item' });
                var itemName = result.getValue({ name: 'itemid', join: 'item' });
                var quantity = result.getValue('quantity');

                // Track unique IF numbers
                uniqueFulfillments[ifNumber] = true;

                if (!processedItems[itemId]) {
                    itemIds.push(itemId);
                    processedItems[itemId] = true;

                    log.debug('Found item from Item Fulfillment', {
                        'fulfillment': ifNumber,
                        'itemId': itemId,
                        'itemName': itemName,
                        'itemType': itemType,
                        'quantity': quantity
                    });
                }

                lineCount++;
                return true;
            });

            var ifNumbers = Object.keys(uniqueFulfillments);
            log.audit('Item Fulfillment search completed', {
                'uniqueItems': itemIds.length,
                'totalLines': lineCount,
                'fulfillments': ifNumbers.length > 0 ? ifNumbers.join(', ') : 'None',
                'fulfillmentCount': ifNumbers.length
            });

            return itemIds;
        }

        /**
         * Find items from Item Receipts (PO Receipts) created in the specified time window
         * This captures inventory increases when items are received
         */
        function findItemReceiptItems(startTimeFormatted, endTimeFormatted) {
            var itemIds = [];
            var processedItems = {};
            var uniqueReceipts = {}; // Track unique receipt numbers

            var receiptSearch = search.create({
                type: search.Type.ITEM_RECEIPT,
                filters: [
                    ['datecreated', 'within', startTimeFormatted, endTimeFormatted],
                    'AND',
                    ['mainline', 'is', 'F'],
                    'AND',
                    ['shipping', 'is', 'F'],
                    'AND',
                    ['taxline', 'is', 'F'],
                    'AND',
                    ['item.type', 'anyof', ['InvtPart']] // Only inventory items on receipts
                ],
                columns: [
                    'tranid',
                    'item',
                    search.createColumn({ name: 'type', join: 'item' }),
                    search.createColumn({ name: 'itemid', join: 'item' }),
                    'quantity',
                    'datecreated'
                ]
            });

            var lineCount = 0;

            receiptSearch.run().each(function(result) {
                var receiptNumber = result.getValue('tranid');
                var itemId = result.getValue('item');
                var itemType = result.getValue({ name: 'type', join: 'item' });
                var itemName = result.getValue({ name: 'itemid', join: 'item' });
                var quantity = result.getValue('quantity');

                // Track unique receipt numbers
                uniqueReceipts[receiptNumber] = true;

                if (!processedItems[itemId]) {
                    itemIds.push(itemId);
                    processedItems[itemId] = true;

                    log.debug('Found item from Item Receipt', {
                        'receipt': receiptNumber,
                        'itemId': itemId,
                        'itemName': itemName,
                        'itemType': itemType,
                        'quantity': quantity
                    });
                }

                lineCount++;
                return true;
            });

            var receiptNumbers = Object.keys(uniqueReceipts);
            log.audit('Item Receipt search completed', {
                'uniqueItems': itemIds.length,
                'totalLines': lineCount,
                'receipts': receiptNumbers.length > 0 ? receiptNumbers.join(', ') : 'None',
                'receiptCount': receiptNumbers.length
            });

            return itemIds;
        }

        // WC-549 FOLLOW-UP: findKitsContainingComponents() moved verbatim to
        // ./lib/NextReceiptCalc.js (nextReceiptCalc.findKitsContainingComponents)
        // so ManualNextReceiptSync_SL.js can reuse the same component->parent-kit
        // search for single-record item->kit propagation. Called below.

        function map(context) {
            try {
                var currentItem = JSON.parse(context.value);
                var itemId = currentItem.id;
                var itemType = currentItem.values.type.value;

                log.debug('Processing item from sales order', {
                    'itemId': itemId,
                    'itemType': itemType
                });

                // Check governance
                var usage = runtime.getCurrentScript().getRemainingUsage();
                if (usage < 100) {
                    log.error('Low governance units remaining', usage);
                    throw error.create({
                        name: 'INSUFFICIENT_GOVERNANCE',
                        message: 'Script approaching governance limit: ' + usage
                    });
                }

                if (itemType == 'InvtPart') {
                    // WC-549 FOLLOW-UP: extracted verbatim into
                    // NextReceiptCalc.calculateInventoryItemReceiptFields() -
                    // same findMyReceipts + sort/select + calcDate +
                    // checkforWeekend sequence that used to run inline here.
                    var itemReceiptFields = nextReceiptCalc.calculateInventoryItemReceiptFields(itemId);

                    context.write({
                        key: itemId,
                        value: {
                            'receiptDate': itemReceiptFields.receiptDate,
                            'quantityOnOrder': itemReceiptFields.quantityOnOrder,
                            'type': itemType
                        }
                    });

                } else {
                    // Kit processing - NEW LOGIC
                    var kitResult = nextReceiptCalc.processKitInventoryAndReceipts(itemId);
                    
                    log.debug('Kit processing result', {
                        'kitId': itemId,
                        'availableQuantity': kitResult.availableQuantity,
                        'nextReceiptDate': kitResult.nextReceiptDate,
                        'nextReceiptQuantity': kitResult.nextReceiptQuantity,
                        'allMemberItemsInStock': kitResult.allMemberItemsInStock
                    });

                    context.write({
                        key: itemId,
                        value: {
                            'receiptDate': kitResult.nextReceiptDate,
                            'quantityOnOrder': kitResult.nextReceiptQuantity,
                            'availableQuantity': kitResult.availableQuantity,
                            'type': itemType
                        }
                    });
                }

            } catch (e) {
                log.error('Error in map phase for item ' + itemId, e);
                throw e;
            }
        }

        function reduce(context) {
            var mapKeyData = context.key;

            for (var j = 0; j < context.values.length; j++) {
                var mapValueData = JSON.parse(context.values[j]);

                if (mapValueData.type == 'InvtPart') {
                    // Lookup current item values before update
                    var currentValues = search.lookupFields({
                        type: search.Type.INVENTORY_ITEM,
                        id: mapKeyData,
                        columns: ['itemid', 'custitem_fmt_next_receipt_date', 'custitem_fmt_next_receipt_quantity']
                    });

                    var newReceiptDate = new Date(mapValueData.receiptDate);
                    var newQuantity = mapValueData.quantityOnOrder;

                    log.debug('Updating Inventory Item', {
                        itemId: mapKeyData,
                        itemName: currentValues.itemid,
                        type: 'InvtPart',
                        original: {
                            receiptDate: currentValues.custitem_fmt_next_receipt_date,
                            quantity: currentValues.custitem_fmt_next_receipt_quantity
                        },
                        updated: {
                            receiptDate: newReceiptDate.toLocaleDateString(),
                            quantity: newQuantity
                        }
                    });

                    record.submitFields({
                        type: record.Type.INVENTORY_ITEM,
                        id: mapKeyData,
                        values: {
                            'custitem_fmt_next_receipt_date': newReceiptDate,
                            'custitem_fmt_next_receipt_quantity': newQuantity
                        }
                    })
                } else {
                    // Lookup current kit item values before update
                    var currentKitValues = search.lookupFields({
                        type: search.Type.KIT_ITEM,
                        id: mapKeyData,
                        columns: ['itemid', 'custitem_fmt_next_receipt_date', 'custitem_fmt_next_receipt_quantity', 'custitem_fmt_avail_kit_quantity']
                    });

                    // WC-549 FOLLOW-UP: these two fallbacks are now the shared
                    // NextReceiptCalc.resolveKitReceiptDate/resolveKitReceiptQuantity
                    // helpers (logic unchanged) so the Suitelet doesn't have to
                    // duplicate them.
                    var dateToSet = nextReceiptCalc.resolveKitReceiptDate(mapValueData.receiptDate);
                    var newAvailableQty = mapValueData.availableQuantity;

                    // WC-549: the kit's next-receipt QUANTITY was computed in map()
                    // (processKitInventoryAndReceipts -> quantityOnOrder) but was never included
                    // in the values submitted below - only the date and available-quantity were
                    // written. Wire it up here, falling back to 20 (mirrors the item-level
                    // default-to-20 fallback used for InvtPart items above) when there's no
                    // PO/inbound-shipment/member data to compute from.
                    var newNextReceiptQty = nextReceiptCalc.resolveKitReceiptQuantity(mapValueData.quantityOnOrder);

                    log.debug('Updating Kit Item', {
                        itemId: mapKeyData,
                        itemName: currentKitValues.itemid,
                        type: 'Kit',
                        original: {
                            receiptDate: currentKitValues.custitem_fmt_next_receipt_date,
                            receiptQuantity: currentKitValues.custitem_fmt_next_receipt_quantity,
                            availableQuantity: currentKitValues.custitem_fmt_avail_kit_quantity
                        },
                        updated: {
                            receiptDate: dateToSet.toLocaleDateString(),
                            receiptQuantity: newNextReceiptQty,
                            availableQuantity: newAvailableQty
                        }
                    });

                    record.submitFields({
                        type: record.Type.KIT_ITEM,
                        id: mapKeyData,
                        values: {
                            'custitem_fmt_next_receipt_date': dateToSet,
                            'custitem_fmt_next_receipt_quantity': newNextReceiptQty,
                            'custitem_fmt_avail_kit_quantity': newAvailableQty
                        }
                    })
                }
            }
        }

        function summarize(context) {
            var inputSummary = context.inputSummary;
            var mapSummary = context.mapSummary;
            var reduceSummary = context.reduceSummary;
            
            log.audit('SALES ORDER DRIVEN SCRIPT SUMMARY', {
                'Input count': inputSummary.inputCount,
                'Map errors': mapSummary.errors.length,
                'Reduce errors': reduceSummary.errors.length,
                'Total usage consumed': 10000 - runtime.getCurrentScript().getRemainingUsage(),
                'Approach': 'Sales Order Driven Processing'
            });

            if (inputSummary.error) {
                var e = error.create({
                    name: 'INPUT_STAGE_FAILED',
                    message: inputSummary.error
                });
                handleErrorAndSendNotification(e, 'getInputData');
            }

            handleErrorInStage('map', mapSummary);
            handleErrorInStage('reduce', reduceSummary);
        }

        // WC-549 FOLLOW-UP: processKitInventoryAndReceipts() and its helpers
        // (getKitMemberDetails, getSingleMemberReceiptFields, getMemberItemInventory,
        // calculateAvailableKitQuantity, calculateKitReceiptQuantity,
        // getInboundShipmentQuantities, getPurchaseOrderQuantities,
        // findEarliestKitCompletionDate, getInboundShipmentDates, getPurchaseOrderDates)
        // moved verbatim to ./lib/NextReceiptCalc.js so ManualNextReceiptSync_SL.js can
        // reuse the exact same kit calculation path. Called via
        // nextReceiptCalc.processKitInventoryAndReceipts(kitId) in map(), above.

        // Include all the helper functions from the original script
        function checkforKitInventory(invArr) {
            var searchResult = {};
            var quantity;

            var kititemSearchObj = search.create({
                type: "kititem",
                filters: [
                    ["type", "anyof", "Kit"],
                    "AND",
                    ["memberitem.inventorylocation", "anyof", "1"],
                    "AND",
                    ["internalid", "anyof", invArr]
                ],
                columns: [
                    search.createColumn({
                        name: "internalid",
                        summary: "GROUP",
                        label: "Internal ID"
                    }),
                    search.createColumn({
                        name: "inventorylocation",
                        join: "memberItem",
                        summary: "GROUP",
                        label: "Inventory Location"
                    }),
                    search.createColumn({
                        name: "formulanumeric",
                        summary: "MIN",
                        formula: "NVL({memberitem.locationquantityavailable},0)/NVL({memberquantity},0)",
                        label: "Formula (Numeric)"
                    })
                ]
            });

            kititemSearchObj.run().each(function (result) {
                quantity = result.getValue({
                    name: "formulanumeric",
                    summary: "MIN",
                    formula: "NVL({memberitem.locationquantityavailable},0)/NVL({memberquantity},0)"
                });

                quantity = parseFloat(quantity);
                quantity = Math.floor(quantity);
                searchResult['currentQuantity'] = quantity;

                return true;
            });

            return searchResult;
        }

        // WC-549 FOLLOW-UP: findMyReceipts() moved verbatim to
        // ./lib/NextReceiptCalc.js (used internally by
        // nextReceiptCalc.calculateInventoryItemReceiptFields()).


        function findMyKitReceipts_ItemRecord(myItems, today) {
            var resArr = [];

            var itemSearchObj = search.create({
                type: "item",
                filters: [
                    ['internalid', 'anyof', myItems]
                ],
                columns: [
                    search.createColumn({
                        name: "custitem_fmt_next_receipt_date", 
                        label: "Next Receipt Date",
                        summary: search.Summary.MAX
                    })
                ]
            });

            itemSearchObj.run().each(function (result) {
                var res2 = {};
                var newReceiptDate = result.getValue({
                    name: "custitem_fmt_next_receipt_date",
                    summary: search.Summary.MAX
                });

                if (!!newReceiptDate) {
                    newReceiptDate = format.parse({
                        value: newReceiptDate,
                        type: format.Type.DATE
                    });
                    res2['receiptDate'] = newReceiptDate;
                    resArr.push(res2);
                }
                return true;
            });

            return resArr;
        }

        // WC-549 FOLLOW-UP: calcDate() and checkforWeekend() moved verbatim to
        // ./lib/NextReceiptCalc.js (used internally by
        // nextReceiptCalc.calculateInventoryItemReceiptFields()).


        function returnKitComponents(itemid, itemArray) {
            var kititemSearchObj = search.create({
                type: "kititem",
                filters: [
                    ["type", "anyof", "Kit"],
                    "AND",
                    ["internalid", "anyof", itemid],
                    "And",
                    ["memberitem.inventorylocation", "anyof", "1"],
                    "AND",
                    ["formulanumeric: case when NVL({memberitem.locationquantityavailable},0)  = 0 then 0 when {memberitem.locationquantityavailable}<{memberquantity} then 0 end", "equalto", "0"]
                ],
                columns: [
                    search.createColumn({
                        name: "internalid",
                        join: "memberItem",
                        label: "Internal ID"
                    }),
                    search.createColumn({name: "memberitem", label: "Member Item"}),
                    search.createColumn({
                        name: "location",
                        join: "memberItem",
                        label: "Location"
                    }),
                    search.createColumn({
                        name: "quantityavailable",
                        join: "memberItem",
                        label: "Available"
                    }),
                    search.createColumn({
                        name: "isavailable",
                        join: "memberItem",
                        label: "Is Available?"
                    }),
                    search.createColumn({
                        name: "quantityonhand",
                        join: "memberItem",
                        label: "On Hand"
                    }),
                    search.createColumn({name: "location", label: "Location"})
                ]
            });

            kititemSearchObj.run().each(function (result) {
                itemArray.push(result.getValue({name: "internalid", join: 'memberItem'}));
                return true;
            });
            return itemArray;
        }

        function handleErrorInStage(stage, summary) {
            var errorMsg = [];
            summary.errors.iterator().each(function (key, value) {
                var msg = 'Failure to update Item: ' + key + '. Error was: ' + JSON.parse(value).message + '\n';
                errorMsg.push(msg);
                return true;
            });
            if (errorMsg.length > 0) {
                var e = error.create({
                    name: 'RECORD_UPDATE_FAILED',
                    message: JSON.stringify(errorMsg)
                });
                handleErrorAndSendNotification(e, stage);
            }
        }

        function handleErrorAndSendNotification(e, stage) {
            log.error('Stage: ' + stage + ' failed', e);
        }

        return {
            getInputData: getInputData,
            map: map,
            reduce: reduce,
            summarize: summarize
        };
    });
