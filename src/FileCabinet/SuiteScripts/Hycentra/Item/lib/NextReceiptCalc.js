/**
 * NextReceiptCalc.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Shared next-receipt-date / next-receipt-quantity / kit-available-quantity
 * calculation library.
 *
 * WC-549 FOLLOW-UP: extracted verbatim (pure extract-and-require refactor,
 * no logic changes) from the scheduled Map/Reduce script
 * UpdateQuantity_ReceiptDate_SalesOrderDriven.js so that:
 *   1. That script keeps producing byte-for-byte identical output (it now
 *      requires this module and calls into it instead of defining these
 *      functions inline).
 *   2. The on-demand ManualNextReceiptSync_SL.js Suitelet can recompute the
 *      SAME fields for a single record without waiting for / faking a
 *      Sales Order, Item Fulfillment, or Item Receipt transaction.
 *
 * Every function below is a PURE CALCULATION / SEARCH READ function - none
 * of them call context.write(), touch Map/Reduce governance, or depend on
 * closures over map()/reduce()-scoped variables. That is what made this a
 * safe, mechanical extraction. The two exceptions that are genuinely NEW
 * code (not present verbatim in the original file) are called out in their
 * own doc comments below:
 *   - calculateInventoryItemReceiptFields(): wraps the InvtPart branch of
 *     map() (previously inline code, not its own function) into a
 *     reusable function. The body inside is moved verbatim; only the
 *     function signature/return wrapper is new.
 *   - resolveKitReceiptDate() / resolveKitReceiptQuantity(): the two
 *     fallback ternaries that used to live inline in reduce()'s kit branch,
 *     pulled out so the Suitelet doesn't have to duplicate that fallback
 *     logic a second time.
 */
define(['N/search', 'N/format', 'underscore'],
    function (search, format, _) {

        // ------------------------------------------------------------------
        // Inventory Item (InvtPart) next-receipt calculation
        // ------------------------------------------------------------------

        /**
         * WC-549: extracted verbatim from map()'s InvtPart branch in
         * UpdateQuantity_ReceiptDate_SalesOrderDriven.js. The original code
         * ran inline inside map() using map()-scoped locals and finished by
         * calling context.write(); this wraps that exact same sequence of
         * calculations in a function and returns the result instead of
         * writing it, so both the M/R script (via context.write in map())
         * and the Suitelet (via record.submitFields directly) can use it.
         *
         * @param {string|number} itemId - Inventory Item internal ID
         * @returns {{receiptDate: Date, quantityOnOrder: number}}
         */
        function calculateInventoryItemReceiptFields(itemId) {
            var receiptDate = {};
            receiptDate['receiptQuantity'] = "";
            var quantityOnOrder = 20;
            var today = new Date();
            var recordType = "";
            var itemType = 'InvtPart';
            var dateFound;

            var day = today.getDate();
            var month = today.getMonth() + 1;
            var year = today.getFullYear();
            var dateToPass = month + "/" + day + "/" + year;

            var receipts = findMyReceipts(itemId, dateToPass);
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
                dateFound = receiptDate.receiptDate;
            }

            if (!!receiptDate.receiptQuantity) {
                quantityOnOrder = receiptDate.receiptQuantity;
            }

            var newDate = calcDate(dateFound, today, recordType, itemType);
            newDate = checkforWeekend(newDate);

            return {
                receiptDate: newDate,
                quantityOnOrder: quantityOnOrder
            };
        }

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
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
                    ["expecteddeliverydate", "onorafter", "daysago10"], // Optimized filter
                    "AND",
                    ["receivinglocation", "anyof", "1"] // WC-549: exclude Castlegate (loc 7), only WC physical location (ID 1)
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

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
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

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
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

        // ------------------------------------------------------------------
        // Kit next-receipt / available-quantity calculation
        // ------------------------------------------------------------------

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
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

                if (!allInStock) {
                    // Kit is not currently fillable if any member is short
                    log.debug('Some kit members out of stock', {
                        'kitId': kitId,
                        'outOfStockMembers': outOfStockMembers
                    });

                    result.availableQuantity = 0; // Kit not available if any member is out of stock
                }

                // WC-549: Next-receipt date/quantity derivation.
                //
                // Kits whose item ID ends in "-000000000" have exactly ONE inventory-item
                // component 100% of the time (naming convention). Detected generally here as
                // "kit has exactly one member" rather than string-matching the SKU suffix, since
                // that's more robust and self-documenting. For those kits, the member's own
                // custitem_fmt_next_receipt_date / custitem_fmt_next_receipt_quantity fields are
                // already correctly maintained by the item-level path (findMyReceipts, above), so
                // we copy them directly instead of re-deriving PO/inbound-shipment logic a second
                // time with different branching. This guarantees kit/item parity by construction.
                //
                // Kits with more than one member (rare/none today per business) always go through
                // the real PO/inbound-shipment lookup - there is no more "all members currently in
                // stock -> stamp today" shortcut. Current on-hand stock status doesn't tell us when
                // the kit's NEXT receipt is actually coming.
                if (kitMembers.length === 1) {
                    var singleMemberReceipt = getSingleMemberReceiptFields(kitMembers[0].memberId);
                    result.nextReceiptDate = singleMemberReceipt.nextReceiptDate;
                    result.nextReceiptQuantity = singleMemberReceipt.nextReceiptQuantity;

                    log.debug('Single-member kit: copied receipt fields from child item', {
                        'kitId': kitId,
                        'memberId': kitMembers[0].memberId,
                        'memberItemId': kitMembers[0].memberItemId,
                        'nextReceiptDate': result.nextReceiptDate,
                        'nextReceiptQuantity': result.nextReceiptQuantity
                    });
                } else {
                    var earliestCompleteDate = findEarliestKitCompletionDate(kitMembers);
                    result.nextReceiptDate = earliestCompleteDate.date;
                    result.nextReceiptQuantity = calculateKitReceiptQuantity(kitMembers);

                    log.debug('Multi-member kit: derived receipt fields from real PO/inbound-shipment lookup', {
                        'kitId': kitId,
                        'memberCount': kitMembers.length,
                        'nextReceiptDate': result.nextReceiptDate,
                        'nextReceiptQuantity': result.nextReceiptQuantity
                    });
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

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
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

        /**
         * WC-549: For single-member kits (e.g. "-000000000" SKUs, which have exactly one
         * inventory-item component by naming convention), the kit's next-receipt date/quantity
         * can just be copied from the member item's own custitem_fmt_next_receipt_date /
         * custitem_fmt_next_receipt_quantity fields - those are already correctly maintained by
         * the item-level path (findMyReceipts / calculateInventoryItemReceiptFields) earlier in
         * this same script run. This is a direct field read, not a recompute, so it's safe to
         * call here.
         *
         * NOTE for Suitelet callers: this reads the member's CURRENTLY STORED field values. If
         * the Suitelet is invoked for the kit directly (not via item-propagation), it will only
         * reflect an up-to-date value if the member item's own fields are already current. That
         * mirrors the M/R script's own behavior/limitation exactly - no change here.
         */
        function getSingleMemberReceiptFields(memberId) {
            var receiptFields = {
                nextReceiptDate: null,
                nextReceiptQuantity: null
            };

            var memberValues = search.lookupFields({
                type: search.Type.INVENTORY_ITEM,
                id: memberId,
                columns: ['custitem_fmt_next_receipt_date', 'custitem_fmt_next_receipt_quantity']
            });

            if (memberValues.custitem_fmt_next_receipt_date) {
                receiptFields.nextReceiptDate = format.parse({
                    value: memberValues.custitem_fmt_next_receipt_date,
                    type: format.Type.DATE
                });
            }

            // Mirror the item-level default-to-20 fallback (calculateInventoryItemReceiptFields,
            // quantityOnOrder) in case the member item hasn't been through the item-level path yet
            // and its field is still blank.
            receiptFields.nextReceiptQuantity = memberValues.custitem_fmt_next_receipt_quantity
                ? parseFloat(memberValues.custitem_fmt_next_receipt_quantity)
                : 20;

            return receiptFields;
        }

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
        function getMemberItemInventory(kitMembers) {
            var inventory = {};
            var memberIds = kitMembers.map(function(member) { return member.memberId; });

            if (memberIds.length === 0) {
                return inventory;
            }

            // Pre-populate all members with 0 so items with no inventory record
            // at location 1 are explicitly treated as zero rather than relying on || 0 fallback
            for (var i = 0; i < memberIds.length; i++) {
                inventory[memberIds[i]] = 0;
            }

            // Use item search with locationquantityavailable to ensure committed quantities are subtracted
            // locationquantityavailable = On Hand - Committed (accounts for orders)
            var inventorySearch = search.create({
                type: "item",
                filters: [
                    ["internalid", "anyof", memberIds],
                    "AND",
                    ["inventorylocation", "anyof", "1"] // Main location - adjust if needed
                ],
                columns: [
                    search.createColumn({
                        name: "internalid",
                        summary: "GROUP",
                        label: "Item ID"
                    }),
                    search.createColumn({
                        name: "locationquantityavailable",
                        summary: "SUM",
                        label: "Available (On Hand - Committed)"
                    }),
                    search.createColumn({
                        name: "locationquantityonhand",
                        summary: "SUM",
                        label: "On Hand"
                    })
                ]
            });

            var itemsFoundInSearch = 0;
            inventorySearch.run().each(function(result) {
                var itemId = result.getValue({ name: "internalid", summary: "GROUP" });
                var availableQty = parseFloat(result.getValue({ name: "locationquantityavailable", summary: "SUM" })) || 0;
                var onHandQty = parseFloat(result.getValue({ name: "locationquantityonhand", summary: "SUM" })) || 0;

                inventory[itemId] = availableQty;  // Overwrite the 0 pre-population with actual value
                itemsFoundInSearch++;

                // Log inventory details for verification (first 5 items to avoid log bloat)
                if (itemsFoundInSearch <= 5) {
                    log.debug('Member item inventory', {
                        'itemId': itemId,
                        'availableQty': availableQty,
                        'onHandQty': onHandQty,
                        'committed': onHandQty - availableQty
                    });
                }

                return true;
            });

            // Log any members that had no inventory record at location 1 (remained at 0)
            var missingItems = [];
            for (var j = 0; j < memberIds.length; j++) {
                if (inventory[memberIds[j]] === 0) {
                    missingItems.push(memberIds[j]);
                }
            }
            if (missingItems.length > 0) {
                log.debug('Member items with zero or no inventory at location 1', {
                    'count': missingItems.length,
                    'memberIds': missingItems.slice(0, 10).join(', ') + (missingItems.length > 10 ? '...' : '')
                });
            }

            return inventory;
        }

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
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

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
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

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
        function getInboundShipmentQuantities(memberIds) {
            var quantities = {};

            var inboundSearch = search.create({
                type: "inboundshipment",
                filters: [
                    ["status", "anyof", ["inTransit", "toBeShipped"]],
                    "AND",
                    ["item", "anyof", memberIds],
                    "AND",
                    ["expecteddeliverydate", "onorafter", "daysago10"],
                    "AND",
                    ["receivinglocation", "anyof", "1"] // WC-549: exclude Castlegate (loc 7), only WC physical location (ID 1)
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

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
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

        // WC-549: called with the multi-member kit's full member list (not just out-of-stock
        // members) - a kit's NEXT receipt depends on incoming PO/inbound-shipment data for every
        // member, regardless of what happens to be on hand right now. Parameter name kept for
        // minimal diff; "outOfStockMembers" here just means "members to look up receipts for".
        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
        function findEarliestKitCompletionDate(outOfStockMembers) {
            var memberIds = outOfStockMembers.map(function(member) { return member.memberId; });
            var latestReceiptDate = null;
            var minKitQuantity = Infinity;

            // Get inbound shipment dates for these members (prioritize over POs)
            var inboundDates = getInboundShipmentDates(memberIds);
            var poDates = getPurchaseOrderDates(memberIds);

            // Find the latest date among all members to complete the kit
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

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
        function getInboundShipmentDates(memberIds) {
            var dates = {};

            var inboundSearch = search.create({
                type: "inboundshipment",
                filters: [
                    ["status", "anyof", ["inTransit", "toBeShipped"]],
                    "AND",
                    ["item", "anyof", memberIds],
                    "AND",
                    ["expecteddeliverydate", "onorafter", "daysago10"],
                    "AND",
                    ["receivinglocation", "anyof", "1"] // WC-549: exclude Castlegate (loc 7), only WC physical location (ID 1)
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

        // Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js
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

        /**
         * Find all kit items that contain the specified component items.
         *
         * Moved verbatim from UpdateQuantity_ReceiptDate_SalesOrderDriven.js's
         * getInputData()-region (used there to expand a component-item event
         * into its parent kit(s) so the kit gets recalculated too). The
         * Suitelet reuses this SAME function to do the same forward lookup
         * (component -> parent kit) for single-record item->kit propagation -
         * no new search logic was written for that purpose.
         */
        function findKitsContainingComponents(componentItemIds) {
            if (!componentItemIds || componentItemIds.length === 0) {
                return [];
            }

            var kitIds = [];
            var processedKits = {};

            // Process in batches to avoid filter limits with large component arrays
            var BATCH_SIZE = 500;
            var totalBatches = Math.ceil(componentItemIds.length / BATCH_SIZE);

            log.audit('Finding kits containing components', {
                'totalComponents': componentItemIds.length,
                'batchSize': BATCH_SIZE,
                'batches': totalBatches
            });

            for (var batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                var startIdx = batchIndex * BATCH_SIZE;
                var endIdx = Math.min(startIdx + BATCH_SIZE, componentItemIds.length);
                var batchComponents = componentItemIds.slice(startIdx, endIdx);

                var kitSearch = search.create({
                    type: 'kititem',
                    filters: [
                        ['type', 'anyof', 'Kit'],
                        'AND',
                        ['memberitem.internalid', 'anyof', batchComponents]
                    ],
                    columns: [
                        'internalid',
                        'itemid',
                        search.createColumn({ name: 'internalid', join: 'memberItem' }),
                        search.createColumn({ name: 'itemid', join: 'memberItem' })
                    ]
                });

                // Use runPaged to handle searches with > 4000 results
                var pagedData = kitSearch.runPaged({
                    pageSize: 1000
                });

                log.debug('Kit search paged info', {
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
                        var kitName = result.getValue('itemid');
                        var componentId = result.getValue({ name: 'internalid', join: 'memberItem' });
                        var componentName = result.getValue({ name: 'itemid', join: 'memberItem' });

                        if (!processedKits[kitId]) {
                            kitIds.push(kitId);
                            processedKits[kitId] = true;

                            // Only log first 10 to avoid log bloat
                            if (kitIds.length <= 10) {
                                log.debug('Found kit containing component', {
                                    'kitId': kitId,
                                    'kitName': kitName,
                                    'componentId': componentId,
                                    'componentName': componentName
                                });
                            }
                        }
                    });
                });
            }

            log.audit('Kit component search completed', {
                'kitsFound': kitIds.length,
                'componentsSearched': componentItemIds.length
            });

            return kitIds;
        }

        // ------------------------------------------------------------------
        // Small shared "value to write" resolvers
        //
        // These two are NOT copied from a single named function in the
        // original file - they're the two inline fallback ternaries that
        // lived directly in reduce()'s kit branch:
        //   dateToSet = !!mapValueData.receiptDate ? new Date(...) : new Date();
        //   newNextReceiptQty = (qty !== null && qty !== undefined) ? qty : 20;
        // Pulled out here (logic unchanged) so reduce() and the Suitelet
        // both call the same fallback instead of maintaining it twice.
        // ------------------------------------------------------------------

        function resolveKitReceiptDate(rawReceiptDate) {
            return !!rawReceiptDate ? new Date(rawReceiptDate) : new Date();
        }

        function resolveKitReceiptQuantity(rawQuantityOnOrder) {
            return (rawQuantityOnOrder !== null && rawQuantityOnOrder !== undefined)
                ? rawQuantityOnOrder
                : 20;
        }

        return {
            calculateInventoryItemReceiptFields: calculateInventoryItemReceiptFields,
            findMyReceipts: findMyReceipts,
            calcDate: calcDate,
            checkforWeekend: checkforWeekend,
            processKitInventoryAndReceipts: processKitInventoryAndReceipts,
            getKitMemberDetails: getKitMemberDetails,
            getSingleMemberReceiptFields: getSingleMemberReceiptFields,
            getMemberItemInventory: getMemberItemInventory,
            calculateAvailableKitQuantity: calculateAvailableKitQuantity,
            calculateKitReceiptQuantity: calculateKitReceiptQuantity,
            getInboundShipmentQuantities: getInboundShipmentQuantities,
            getPurchaseOrderQuantities: getPurchaseOrderQuantities,
            findEarliestKitCompletionDate: findEarliestKitCompletionDate,
            getInboundShipmentDates: getInboundShipmentDates,
            getPurchaseOrderDates: getPurchaseOrderDates,
            findKitsContainingComponents: findKitsContainingComponents,
            resolveKitReceiptDate: resolveKitReceiptDate,
            resolveKitReceiptQuantity: resolveKitReceiptQuantity
        };
    });
