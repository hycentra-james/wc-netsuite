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
 */

define(['N/search', 'N/record', 'N/query', 'N/runtime', 'N/error', 'N/format', 'underscore', '../moment.min'],
    function (search, record, query, runtime, error, format, _, moment) {

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

                // Step 3: Find kits that contain any of the inventory items from IF/Receipt
                // This ensures kit quantities are updated when their components change
                var inventoryItemsFromEvents = [];
                for (var i = 0; i < fulfillmentItems.length; i++) {
                    if (inventoryItemsFromEvents.indexOf(fulfillmentItems[i]) === -1) {
                        inventoryItemsFromEvents.push(fulfillmentItems[i]);
                    }
                }
                for (var j = 0; j < receiptItems.length; j++) {
                    if (inventoryItemsFromEvents.indexOf(receiptItems[j]) === -1) {
                        inventoryItemsFromEvents.push(receiptItems[j]);
                    }
                }

                var affectedKits = findKitsContainingComponents(inventoryItemsFromEvents);
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

            // Find kit components for any kit items in the list
            var kitComponentSearch = search.create({
                type: 'kititem',
                filters: [
                    ['internalid', 'anyof', itemIds],
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

            kitComponentSearch.run().each(function(result) {
                var kitId = result.getValue('internalid');
                var componentId = result.getValue({ name: 'internalid', join: 'memberItem' });
                var componentItemId = result.getValue({ name: 'itemid', join: 'memberItem' });
                var componentType = result.getValue({ name: 'type', join: 'memberItem' });

                if (componentId && allItems.indexOf(componentId) === -1) {
                    allItems.push(componentId);
                    kitComponentIds.push(componentId);
                    
                    log.debug('Added kit component', {
                        'kitId': kitId,
                        'componentId': componentId,
                        'componentItemId': componentItemId,
                        'componentType': componentType
                    });
                }

                return true;
            });

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

        /**
         * Find all kit items that contain the specified component items
         * This ensures kits are recalculated when their components change
         */
        function findKitsContainingComponents(componentItemIds) {
            if (!componentItemIds || componentItemIds.length === 0) {
                return [];
            }

            var kitIds = [];
            var processedKits = {};

            var kitSearch = search.create({
                type: 'kititem',
                filters: [
                    ['type', 'anyof', 'Kit'],
                    'AND',
                    ['memberitem.internalid', 'anyof', componentItemIds]
                ],
                columns: [
                    'internalid',
                    'itemid',
                    search.createColumn({ name: 'internalid', join: 'memberItem' }),
                    search.createColumn({ name: 'itemid', join: 'memberItem' })
                ]
            });

            kitSearch.run().each(function(result) {
                var kitId = result.getValue('internalid');
                var kitName = result.getValue('itemid');
                var componentId = result.getValue({ name: 'internalid', join: 'memberItem' });
                var componentName = result.getValue({ name: 'itemid', join: 'memberItem' });

                if (!processedKits[kitId]) {
                    kitIds.push(kitId);
                    processedKits[kitId] = true;

                    log.debug('Found kit containing component', {
                        'kitId': kitId,
                        'kitName': kitName,
                        'componentId': componentId,
                        'componentName': componentName
                    });
                }

                return true;
            });

            log.audit('Kit component search completed', {
                'kitsFound': kitIds.length,
                'componentsSearched': componentItemIds.length
            });

            return kitIds;
        }

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

                var receiptDate = {};
                receiptDate['receiptQuantity'] = "";
                var quantityOnOrder = 20;
                var today = new Date();
                var recordType = "";

                var day = today.getDate();
                var month = today.getMonth() + 1;
                var year = today.getFullYear();
                var dateToPass = month + "/" + day + "/" + year;

                var receipts = [];

                if (itemType == 'InvtPart') {
                    receipts = findMyReceipts(itemId, dateToPass);
                    if (!!receipts && receipts.length > 0) {
                        receipts = _.sortBy(receipts, function (o) {
                            return o.receiptDate
                        });
                        receipts = receipts.reverse();
                    }

                    if (!!receipts && receipts.length > 0) {
                        var receiptLength = receipts.length;
                        receiptDate = receipts[receiptLength - 1];
                        recordType = receiptDate.type;
                        var dateFound = receiptDate.receiptDate;
                    }

                    if (!!receiptDate.receiptQuantity) {
                        quantityOnOrder = receiptDate.receiptQuantity;
                    }

                    var newDate = calcDate(dateFound, today, recordType, itemType);
                    newDate = checkforWeekend(newDate);

                    context.write({
                        key: itemId,
                        value: {
                            'receiptDate': newDate,
                            'quantityOnOrder': quantityOnOrder,
                            'type': itemType
                        }
                    });

                } else {
                    // Kit processing - NEW LOGIC
                    var kitResult = processKitInventoryAndReceipts(itemId);
                    
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
                        columns: ['itemid', 'custitem_fmt_next_receipt_date', 'custitem_fmt_avail_kit_quantity']
                    });

                    var dateToSet;
                    if (!!mapValueData.receiptDate) {
                        dateToSet = new Date(mapValueData.receiptDate);
                    } else {
                        dateToSet = new Date();
                    }
                    var newAvailableQty = mapValueData.availableQuantity;

                    log.debug('Updating Kit Item', {
                        itemId: mapKeyData,
                        itemName: currentKitValues.itemid,
                        type: 'Kit',
                        original: {
                            receiptDate: currentKitValues.custitem_fmt_next_receipt_date,
                            availableQuantity: currentKitValues.custitem_fmt_avail_kit_quantity
                        },
                        updated: {
                            receiptDate: dateToSet.toLocaleDateString(),
                            availableQuantity: newAvailableQty
                        }
                    });

                    record.submitFields({
                        type: record.Type.KIT_ITEM,
                        id: mapKeyData,
                        values: {
                            'custitem_fmt_next_receipt_date': dateToSet,
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

        // NEW KIT PROCESSING FUNCTION - Implements sophisticated kit logic
        function processKitInventoryAndReceipts(kitId) {
            var result = {
                availableQuantity: 0,
                nextReceiptDate: null,
                nextReceiptQuantity: null,
                allMemberItemsInStock: false
            };

            try {
                // Step 1: Get kit member items with their required quantities
                var kitMembers = getKitMemberDetails(kitId);
                
                if (!kitMembers || kitMembers.length === 0) {
                    log.debug('No kit members found', kitId);
                    return result;
                }

                log.debug('Kit members found', {
                    'kitId': kitId,
                    'memberCount': kitMembers.length,
                    'members': kitMembers
                });

                // Step 2: Check current inventory for each member item
                var memberInventory = getMemberItemInventory(kitMembers);
                
                // Step 3: Calculate available kit quantity (minimum based on member ratios)
                var availableKits = calculateAvailableKitQuantity(kitMembers, memberInventory);
                result.availableQuantity = availableKits;

                // Step 4: Check if all member items have sufficient stock
                var allInStock = true;
                var outOfStockMembers = [];
                
                for (var i = 0; i < kitMembers.length; i++) {
                    var member = kitMembers[i];
                    var availableQty = memberInventory[member.memberId] || 0;
                    var requiredQty = member.memberQuantity;
                    
                    if (availableQty < requiredQty) {
                        allInStock = false;
                        outOfStockMembers.push({
                            memberId: member.memberId,
                            memberItemId: member.memberItemId,
                            availableQty: availableQty,
                            requiredQty: requiredQty,
                            shortfall: requiredQty - availableQty
                        });
                    }
                }

                result.allMemberItemsInStock = allInStock;

                if (allInStock) {
                    // Case 1: All member items are in stock
                    log.debug('All kit members in stock', kitId);
                    result.nextReceiptDate = new Date(moment().format('M/D/YYYY')); // Today
                    
                    // Calculate next receipt quantity from inbound shipments and POs
                    result.nextReceiptQuantity = calculateKitReceiptQuantity(kitMembers);
                    
                } else {
                    // Case 2: Some member items are out of stock
                    log.debug('Some kit members out of stock', {
                        'kitId': kitId,
                        'outOfStockMembers': outOfStockMembers
                    });
                    
                    result.availableQuantity = 0; // Kit not available if any member is out of stock
                    
                    // Find earliest date when all out-of-stock items will be available
                    var earliestCompleteDate = findEarliestKitCompletionDate(outOfStockMembers);
                    result.nextReceiptDate = earliestCompleteDate.date;
                    result.nextReceiptQuantity = earliestCompleteDate.quantity;
                }

                return result;

            } catch (e) {
                log.error('Error in processKitInventoryAndReceipts', {
                    'kitId': kitId,
                    'error': e
                });
                return result;
            }
        }

        function getKitMemberDetails(kitId) {
            var members = [];
            
            var kitMemberSearch = search.create({
                type: "kititem",
                filters: [
                    ["internalid", "anyof", kitId],
                    "AND",
                    ["type", "anyof", "Kit"]
                ],
                columns: [
                    search.createColumn({ name: "internalid", join: "memberItem", label: "Member ID" }),
                    search.createColumn({ name: "itemid", join: "memberItem", label: "Member Item ID" }),
                    search.createColumn({ name: "memberquantity", label: "Member Quantity" }),
                    search.createColumn({ name: "type", join: "memberItem", label: "Member Type" })
                ]
            });

            kitMemberSearch.run().each(function(result) {
                var memberId = result.getValue({ name: "internalid", join: "memberItem" });
                var memberItemId = result.getValue({ name: "itemid", join: "memberItem" });
                var memberQuantity = parseFloat(result.getValue("memberquantity")) || 1;
                var memberType = result.getValue({ name: "type", join: "memberItem" });

                if (memberId && memberType === 'InvtPart') { // Only inventory items
                    members.push({
                        memberId: memberId,
                        memberItemId: memberItemId,
                        memberQuantity: memberQuantity,
                        memberType: memberType
                    });
                }

                return true;
            });

            return members;
        }

        function getMemberItemInventory(kitMembers) {
            var inventory = {};
            var memberIds = kitMembers.map(function(member) { return member.memberId; });

            if (memberIds.length === 0) {
                return inventory;
            }

            // Use inventory balance search to get available quantities
            var inventorySearch = search.create({
                type: "inventorybalance",
                filters: [
                    ["item", "anyof", memberIds],
                    "AND",
                    ["location", "anyof", "1"] // Main location - adjust if needed
                ],
                columns: [
                    search.createColumn({ name: "item", summary: "GROUP" }),
                    search.createColumn({ name: "available", summary: "SUM" })
                ]
            });

            inventorySearch.run().each(function(result) {
                var itemId = result.getValue({ name: "item", summary: "GROUP" });
                var qty = parseFloat(result.getValue({ name: "available", summary: "SUM" })) || 0;
                
                inventory[itemId] = qty;

                return true;
            });

            return inventory;
        }

        function calculateAvailableKitQuantity(kitMembers, memberInventory) {
            var minKits = Infinity;

            for (var i = 0; i < kitMembers.length; i++) {
                var member = kitMembers[i];
                var availableQty = memberInventory[member.memberId] || 0;
                var requiredQty = member.memberQuantity;
                
                var possibleKits = Math.floor(availableQty / requiredQty);
                minKits = Math.min(minKits, possibleKits);
            }

            return minKits === Infinity ? 0 : minKits;
        }

        function calculateKitReceiptQuantity(kitMembers) {
            var memberIds = kitMembers.map(function(member) { return member.memberId; });
            var totalExpectedKits = 0;

            if (memberIds.length === 0) {
                return 0;
            }

            // Get inbound shipments for member items
            var inboundQty = getInboundShipmentQuantities(memberIds);
            var poQty = getPurchaseOrderQuantities(memberIds);

            // Calculate how many complete kits can be made from expected receipts
            var minKitsFromReceipts = Infinity;

            for (var i = 0; i < kitMembers.length; i++) {
                var member = kitMembers[i];
                var expectedQty = (inboundQty[member.memberId] || 0) + (poQty[member.memberId] || 0);
                var possibleKits = Math.floor(expectedQty / member.memberQuantity);
                minKitsFromReceipts = Math.min(minKitsFromReceipts, possibleKits);
            }

            return minKitsFromReceipts === Infinity ? 0 : minKitsFromReceipts;
        }

        function getInboundShipmentQuantities(memberIds) {
            var quantities = {};

            var inboundSearch = search.create({
                type: "inboundshipment",
                filters: [
                    ["status", "anyof", ["inTransit", "toBeShipped"]],
                    "AND",
                    ["item", "anyof", memberIds],
                    "AND",
                    ["expecteddeliverydate", "onorafter", "daysago10"]
                ],
                columns: [
                    search.createColumn({ name: "item", summary: "GROUP" }),
                    search.createColumn({ name: "quantityexpected", summary: "SUM" })
                ]
            });

            inboundSearch.run().each(function(result) {
                var itemId = result.getValue({ name: "item", summary: "GROUP" });
                var qty = parseFloat(result.getValue({ name: "quantityexpected", summary: "SUM" })) || 0;
                quantities[itemId] = qty;
                return true;
            });

            return quantities;
        }

        function getPurchaseOrderQuantities(memberIds) {
            var quantities = {};

            var poSearch = search.create({
                type: "transaction",
                filters: [
                    ["type", "anyof", "PurchOrd"],
                    "AND",
                    ["mainline", "is", "F"],
                    "AND",
                    ["item", "anyof", memberIds],
                    "AND",
                    ["expectedreceiptdate", "onorafter", "daysago45"]
                ],
                columns: [
                    search.createColumn({ name: "item", summary: "GROUP" }),
                    search.createColumn({ 
                        name: "formulanumeric", 
                        formula: "ABS({quantity}-{quantityshiprecv})", 
                        summary: "SUM" 
                    })
                ]
            });

            poSearch.run().each(function(result) {
                var itemId = result.getValue({ name: "item", summary: "GROUP" });
                var qty = parseFloat(result.getValue({ 
                    name: "formulanumeric", 
                    formula: "ABS({quantity}-{quantityshiprecv})", 
                    summary: "SUM" 
                })) || 0;
                quantities[itemId] = qty;
                return true;
            });

            return quantities;
        }

        function findEarliestKitCompletionDate(outOfStockMembers) {
            var memberIds = outOfStockMembers.map(function(member) { return member.memberId; });
            var latestReceiptDate = null;
            var minKitQuantity = Infinity;

            // Get inbound shipment dates for out-of-stock members (prioritize over POs)
            var inboundDates = getInboundShipmentDates(memberIds);
            var poDates = getPurchaseOrderDates(memberIds);

            // Find the latest date among all out-of-stock items to complete the kit
            for (var i = 0; i < outOfStockMembers.length; i++) {
                var member = outOfStockMembers[i];
                var receiptDate = inboundDates[member.memberId] || poDates[member.memberId];
                
                if (receiptDate && (!latestReceiptDate || receiptDate > latestReceiptDate)) {
                    latestReceiptDate = receiptDate;
                }
            }

            // Calculate minimum kit quantity based on expected receipts
            // This is simplified - could be enhanced with more sophisticated logic
            minKitQuantity = 1; // Conservative estimate

            return {
                date: latestReceiptDate,
                quantity: minKitQuantity === Infinity ? 1 : minKitQuantity
            };
        }

        function getInboundShipmentDates(memberIds) {
            var dates = {};

            var inboundSearch = search.create({
                type: "inboundshipment",
                filters: [
                    ["status", "anyof", ["inTransit", "toBeShipped"]],
                    "AND",
                    ["item", "anyof", memberIds],
                    "AND",
                    ["expecteddeliverydate", "onorafter", "daysago10"]
                ],
                columns: [
                    search.createColumn({ name: "item", summary: "GROUP" }),
                    search.createColumn({ name: "expecteddeliverydate", summary: "MIN", sort: search.Sort.ASC })
                ]
            });

            inboundSearch.run().each(function(result) {
                var itemId = result.getValue({ name: "item", summary: "GROUP" });
                var dateStr = result.getValue({ name: "expecteddeliverydate", summary: "MIN" });
                
                if (dateStr) {
                    dates[itemId] = format.parse({
                        value: dateStr,
                        type: format.Type.DATE
                    });
                }
                return true;
            });

            return dates;
        }

        function getPurchaseOrderDates(memberIds) {
            var dates = {};

            var poSearch = search.create({
                type: "transaction",
                filters: [
                    ["type", "anyof", "PurchOrd"],
                    "AND",
                    ["mainline", "is", "F"],
                    "AND",
                    ["item", "anyof", memberIds],
                    "AND",
                    ["expectedreceiptdate", "onorafter", "daysago45"]
                ],
                columns: [
                    search.createColumn({ name: "item", summary: "GROUP" }),
                    search.createColumn({ name: "expectedreceiptdate", summary: "MIN", sort: search.Sort.ASC })
                ]
            });

            poSearch.run().each(function(result) {
                var itemId = result.getValue({ name: "item", summary: "GROUP" });
                var dateStr = result.getValue({ name: "expectedreceiptdate", summary: "MIN" });
                
                if (dateStr) {
                    dates[itemId] = format.parse({
                        value: dateStr,
                        type: format.Type.DATE
                    });
                }
                return true;
            });

            return dates;
        }

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

        function findMyReceipts(myItems, today) {
            var resArr = [];
            var inbShipsFound = false;

            var inboundshipmentSearchObj = search.create({
                type: "inboundshipment",
                filters: [
                    ["status", "anyof", ["inTransit", "toBeShipped"]],
                    "AND",
                    ["item", "anyof", myItems],
                    "AND",
                    ["expecteddeliverydate", "onorafter", "daysago10"] // Optimized filter
                ],
                columns: [
                    search.createColumn({
                        name: "expecteddeliverydate",
                        summary: "GROUP",
                        sort: search.Sort.ASC,
                        label: "Expected Delivery Date"
                    }),
                    search.createColumn({
                        name: "quantityexpected",
                        summary: "SUM",
                        label: "Items - Quantity Expected"
                    })
                ]
            });

            inboundshipmentSearchObj.run().each(function (result) {
                var res2 = {};
                var newReceiptDate = result.getValue({
                    name: "expecteddeliverydate",
                    summary: search.Summary.GROUP
                });

                if (!!newReceiptDate) {
                    newReceiptDate = format.parse({
                        value: newReceiptDate,
                        type: format.Type.DATE
                    });

                    res2['receiptDate'] = newReceiptDate;
                    res2['receiptQuantity'] = result.getValue({
                        name: "quantityexpected",
                        summary: search.Summary.SUM
                    });
                    res2['type'] = "InboundShipment";
                    resArr.push(res2);
                }
                inbShipsFound = true;
                return true;
            });

            if (!inbShipsFound) {
                var transactionSearchObj = search.create({
                    type: "transaction",
                    filters: [
                        ["type", "anyof", "PurchOrd"],
                        "AND",
                        ["mainline", "is", "F"],
                        "AND",
                        ["shipping", "is", "F"],
                        "AND",
                        ["taxline", "is", "F"],
                        "AND",
                        ["item", "anyof", myItems],
                        "AND",
                        ["expectedreceiptdate", "onorafter", "daysago45"] // Optimized filter
                    ],
                    columns: [
                        search.createColumn({name: "item", label: "Item"}),
                        search.createColumn({
                            name: "formulanumeric",
                            formula: "ABS({quantity}-{quantityshiprecv})",
                            label: "Updated Quantity"
                        }),
                        search.createColumn({
                            name: "expectedreceiptdate",
                            sort: search.Sort.ASC,
                            label: "Expected Receipt Date"
                        })
                    ]
                });

                transactionSearchObj.run().each(function (result) {
                    var res = {};
                    var receiptDate2 = result.getValue({
                        name: "expectedreceiptdate",
                    });

                    if (!!receiptDate2) {
                        receiptDate2 = format.parse({
                            value: receiptDate2,
                            type: format.Type.DATE
                        });

                        res['receiptDate'] = receiptDate2;
                        res['receiptQuantity'] = result.getValue({
                            name: "formulanumeric",
                        });
                        res['type'] = "PurchaseOrder";
                        resArr.push(res);
                    }
                    return true;
                });
            }

            return resArr;
        }

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

        function calcDate(receiptDate, trandate, type, recordType) {
            var myItemType = recordType;
            var dateToReturn;
            var tenDayDelay = parseInt(10);
            var thirtyDayDelay = parseInt(45);
            var ninetyDayDelay = parseInt(90);

            if (myItemType == "InvtPart") {
                if (!!receiptDate && receiptDate != '' && type == "InboundShipment") {
                    receiptDate = new Date(receiptDate);
                    receiptDate = receiptDate.setDate(receiptDate.getDate() + tenDayDelay);
                    dateToReturn = format.parse({
                        value: new Date(receiptDate),
                        type: format.Type.DATE
                    });
                } else if (!!receiptDate && receiptDate != '' && type == "PurchaseOrder") {
                    receiptDate = new Date(receiptDate);
                    receiptDate = receiptDate.setDate(receiptDate.getDate() + thirtyDayDelay);
                    dateToReturn = format.parse({
                        value: new Date(receiptDate),
                        type: format.Type.DATE
                    });
                } else {
                    trandate = new Date(trandate);
                    trandate = trandate.setDate(trandate.getDate() + ninetyDayDelay);
                    dateToReturn = format.parse({
                        value: new Date(trandate),
                        type: format.Type.DATE
                    });
                }
                return dateToReturn;
            } else {
                if (receiptDate == "") {
                    trandate = new Date(trandate);
                    trandate = trandate.setDate(trandate.getDate() + ninetyDayDelay);
                    dateToReturn = format.parse({
                        value: new Date(trandate),
                        type: format.Type.DATE
                    });
                } else {
                    dateToReturn = receiptDate;
                }
                return dateToReturn;
            }
        }

        function checkforWeekend(dateToReturn) {
            var isSaturday = parseInt(2);
            var isSunday = parseInt(1);
            var checkDate;

            checkDate = dateToReturn.getDay();

            if (checkDate === 6) {
                dateToReturn = new Date(dateToReturn);
                dateToReturn = dateToReturn.setDate(dateToReturn.getDate() + isSaturday);
                dateToReturn = format.parse({
                    value: new Date(dateToReturn),
                    type: format.Type.DATE
                });
            } else if (checkDate == 0) {
                dateToReturn = new Date(dateToReturn);
                dateToReturn = dateToReturn.setDate(dateToReturn.getDate() + isSunday);
                dateToReturn = format.parse({
                    value: new Date(dateToReturn),
                    type: format.Type.DATE
                });
            } else {
                dateToReturn = format.parse({
                    value: new Date(dateToReturn),
                    type: format.Type.DATE
                });
            }

            return dateToReturn;
        }

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
