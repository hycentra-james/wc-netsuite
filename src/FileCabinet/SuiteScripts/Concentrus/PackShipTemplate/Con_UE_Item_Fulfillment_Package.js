/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search'],
    function (record, search) {
        /**
         * DEPLOYMENT INSTRUCTIONS:
         *
         * 1. Upload this script to NetSuite (Customization > Scripting > Scripts > New)
         * 2. Create a User Event Script deployment:
         *    - Record Type: Item Fulfillment
         *    - Event Type: After Submit
         *    - Execution Context: All
         * 3. Update the SMALL_PARCEL_SHIP_IDS and LTL_SHIP_IDS arrays with your actual ship method internal IDs
         * 4. Test thoroughly in your sandbox environment before deploying to production
         *
         * CONFIGURATION:
         * - Edit SMALL_PARCEL_SHIP_IDS and LTL_SHIP_IDS arrays to include your ship method internal IDs
         * - Adjust package weight default value if needed
         * - Modify item type detection logic if you have custom item types
         */



            // User-configurable arrays for ship method groups
        const SMALL_PARCEL_SHIP_IDS = ['3', '15', '3786', '16', '3783', '17', '19', '20', '22', '3785', '23', '3784', '40', '3778', '3779', '41', '4', '43', '3780', '8988', '3776', '3777', '44', '3766'];
        const LTL_SHIP_IDS = ['10443', '6', '7', '3794', '8', '11391', '9505', '13528', '7730', '7747', '8775', '9608', '7853', '9815', '9', '11078', '10856', '3800', '10', '10336', '7123', '10754', '6720', '10126', '7227', '10644', '11', '12', '13', '8881', '9496', '9811', '3904', '8880', '9606', '3787', '3771', '10752', '10751', '3803', '13219', '18', '11597', '11596', '3774', '24', '7729', '8991', '8776', '9809', '11709', '10019', '25', '6618', '26', '27', '28', '29', '9502', '9500', '9501', '8669', '30', '10123', '3909', '6719', '9193', '7731', '9503', '8989', '31', '10128', '8164', '3801', '7745', '13218', '32', '3788', '10124', '33', '3770', '34', '3769', '8165', '35', '10749', '10750', '9607', '13537', '36', '8990', '10965', '10122', '3753', '8882', '8267', '10020', '37', '7732', '8266', '38', '10442', '3775', '7226', '10755', '39', '10125', '11071', '42', '44', '3766', '7733', '7954', '7849', '10127', '45', '46', '47'];

        // NetSuite item type constants
        const ITEM_TYPE_KIT = 'Kit';


        function beforeLoad(context) {
        }

        function beforeSubmit(context) {
        }

        function afterSubmit(context) {
            // Only process on edit/create operations
            log.debug('context.type', context.type)
            if (context.type !== context.UserEventType.EDIT
                && context.type !== context.UserEventType.CREATE
                && context.type !== context.UserEventType.SHIP
                // && context.type !== context.UserEventType.PACK
            ) {
                return;
            }

            let newRecord = context.newRecord;
            let oldRecord = context.oldRecord;

            // Get current and previous status
            let currentStatus = newRecord.getText('shipstatus');
            let previousStatus = oldRecord ? oldRecord.getText('shipstatus') : null;

            // Get ship method
            let shipMethod = newRecord.getValue('shipmethod');
            log.debug('record', {currentStatus, previousStatus, shipMethod})

            if (!shipMethod) {
                log.debug('Ship Method', 'No ship method found on item fulfillment');
                return;
            }

            let shipMethodId = shipMethod.toString();

            // Check for Case: Ship method in SMALL_PARCEL_SHIP_IDS and status changed to Shipped
            if (SMALL_PARCEL_SHIP_IDS.indexOf(shipMethodId) !== -1 && currentStatus === 'Shipped' && previousStatus !== 'Shipped') {
                log.debug('Case SmallParcel Triggered', 'Ship method in SMALL_PARCEL_SHIP_IDS and status changed to Packed');
                processCaseSmallParcel(newRecord);
            }

            // Check for Case 2: Ship method in LTL_SHIP_IDS and status changed to Packed
            if (LTL_SHIP_IDS.indexOf(shipMethodId) !== -1 && currentStatus === 'Shipped' && previousStatus !== 'Shipped') {
                log.debug('Case LTL Triggered', 'Ship method in LTL_SHIP_IDS and status changed to Packed');
                processCaseLtl(newRecord);
            }
        }

        function isSentToDeposco(fulfillmentRecord) {
            let sentToDeposco = fulfillmentRecord.getValue({
                fieldId: 'custbody_deposco_pulled'
            });
            return false && sentToDeposco;
        }

        function getItemData(fulfillmentRecord) {
            let sublistItems = [];

            let itemCount = fulfillmentRecord.getLineCount('item');

            for (let i = 0; i < itemCount; i++) {
                let itemId = fulfillmentRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: i
                });

                let quantity = fulfillmentRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: i
                });

                let itemType = fulfillmentRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemtype',
                    line: i
                });

                let itemName = fulfillmentRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemname',
                    line: i
                });

                let kitMemberOf = fulfillmentRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'kitmemberof',
                    line: i
                });

                // Check if item is a kit
                sublistItems.push({
                    id: itemId,
                    name: itemName,
                    quantity: quantity,
                    type: itemType,
                    kitMemberOf,
                    line: i
                })

                log.debug('Kit Item Found', 'Name: ' + itemName + ', Quantity: ' + quantity);
            }

            return sublistItems;
        }

        function getItemDetail(items) {
            let searchObj = search.create({
                type: 'kititem',
                filters: [
                    ['type', 'anyof', 'Kit', 'InvtPart'],
                    "AND",
                    ['internalid', 'anyof'].concat(items)
                ],
                columns: [
                    {name: 'itemid', sort: search.Sort.ASC},
                    {name: 'displayname'},
                    {name: 'salesdescription'},
                    {name: 'type'},
                    {name: 'custitem_fmt_pallet_weight'},
                    {name: 'custitem_fmt_total_carton_weight'},
                    {name: 'custitem_fmt_shipping_weight'},
                    {name: 'custitem_fmt_pallet_quantity'}
                ]
            });
            let searchResultCount = searchObj.runPaged().count;
            log.debug("searchObj result count", searchResultCount);
            let results = {};
            searchObj.run().each(function (result) {
                results[result.id] = {
                    palletWeight: result.getValue({name: 'custitem_fmt_pallet_weight'}),
                    cartonWeight: result.getValue({name: 'custitem_fmt_total_carton_weight'}),
                    shippingWeight: result.getValue({name: 'custitem_fmt_shipping_weight'}),
                    palletQuantity: Number(result.getValue({name: 'custitem_fmt_pallet_quantity'}))
                };
                return true;
            });
            return results;
        }

        function processCaseLtl(fulfillmentRecord) {
            let items = getItemData(fulfillmentRecord);
            let itemDetailLookup = getItemDetail(items.map(item => item.id));
            log.debug('items', items)
            if (items.length === 0) {
                log.debug('Case LTL', 'No kit items found');
                return;
            }

            // Load record for editing
            let recordToEdit = record.load({
                type: record.Type.ITEM_FULFILLMENT,
                id: fulfillmentRecord.id
            });
            if (isSentToDeposco(recordToEdit)) {
                return
            }
            let salesOrderId = recordToEdit.getValue({
                fieldId: 'createdfrom'
            })
            let soLookup = search.lookupFields({
                type: 'salesorder',
                id: salesOrderId,
                columns: ['custbody_pro_number']
            })
            let proNumber = soLookup.custbody_pro_number
            log.debug('proNumber', proNumber)

            // Clear existing package lines
            let packageCount = recordToEdit.getLineCount('package');
            let i
            for (i = packageCount - 1; i >= 0; i--) {
                recordToEdit.removeLine({
                    sublistId: 'package',
                    line: i
                });
            }

            // Create one package line per kit item
            items.forEach(function (item) {
                log.debug('items item', item)
                if (item.kitMemberOf) {
                    // member item should not be listed
                    return
                }

                let palletQuantity = itemDetailLookup[item.id].palletQuantity
                let itemQuantity = item.quantity
                let numberOfPackages = Number(palletQuantity) * Number(itemQuantity)


                let q;
                for (q = 0; q < numberOfPackages; q++) {
                    recordToEdit.insertLine({
                        sublistId: 'package',
                        line: 0
                    });

                    let contentDescription = item.name + '(1.0)';

                    recordToEdit.setSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagedescr',
                        line: 0,
                        value: contentDescription
                    });

                    recordToEdit.setSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagetrackingnumber',
                        line: 0,
                        value: proNumber
                    });

                    // Set other required package fields if needed
                    recordToEdit.setSublistValue({
                        sublistId: 'package',
                        fieldId: 'packageweight',
                        line: 0,
                        value: itemDetailLookup[item.id].shippingWeight // Default weight, adjust as needed
                    });
                }
            });

            recordToEdit.save();
            log.debug('Case LTL Completed', 'Package lines updated for ' + items.length + ' kit items');
        }

        function getCartons(id) {
            let searchObj = search.create({
                type: 'customrecord_packship_cartonitem',
                filters: [
                    ['custrecord_packship_itemfulfillment', 'anyof', id]
                ],
                columns: [
                    {name: 'custrecord_packship_carton'},
                    {name: 'custrecord_packship_itemfulfillment'},
                    {name: 'custrecord_packship_fulfillmentitem'},
                    {name: 'custrecord_packship_totalpickedqty'},
                    {name: 'custrecord_packship_totalpackedqty'},
                    {name: 'custrecord_fulfillment_id'}
                ]
            });
            let searchResultCount = searchObj.runPaged().count;
            log.debug("searchObj result count", searchResultCount);
            let results = [];
            searchObj.run().each(function (result) {
                results.push({
                    packShipCarton: result.getValue({name: 'custrecord_packship_carton'}),
                    packShipItemFulfillment: result.getValue({name: 'custrecord_packship_itemfulfillment'}),
                    packShipFulfillmentItem: result.getValue({name: 'custrecord_packship_fulfillmentitem'}),
                    packShipFulfillmentItemName: result.getText({name: 'custrecord_packship_fulfillmentitem'}),
                    packShipTotalPickedQty: result.getValue({name: 'custrecord_packship_totalpickedqty'}),
                    packShipTotalPackedQty: result.getValue({name: 'custrecord_packship_totalpackedqty'}),
                    packShipFulfillmentId: result.getValue({name: 'custrecord_fulfillment_id'})
                });
                return true;
            });
            return results;
        }

        function processCaseSmallParcel(fulfillmentRecord) {
            let items = getItemData(fulfillmentRecord);
            let itemDetailLookup = getItemDetail(items.map(item => item.id));
            log.debug('fulfillmentRecord.id', fulfillmentRecord.id)
            log.debug('items', items)
            if (items.length === 0) {
                log.debug('Case eSmallParcel', 'No kit items found');
                return;
            }

            // Load record for editing
            let recordToEdit = record.load({
                type: record.Type.ITEM_FULFILLMENT,
                id: fulfillmentRecord.id,
                isDynamic: true,
            });

            if (isSentToDeposco(recordToEdit)) {
                return
            }

            // Create one package line per unit quantity of each kit item
            let currentLine = 0
            items.forEach(function (item, index, arr) {
                log.debug('items item', item)
                log.debug('currentLine', currentLine)
                if (item.kitMemberOf) {
                    // member item should not be listed
                    return
                }

                for (let i = 0; i < item.quantity; i++) {
                    // Create individual package lines for each unit
                    recordToEdit.selectLine({
                        sublistId: 'package',
                        line: currentLine
                    });

                    // let qty = carton.packShipTotalPackedQty.toFixed(1);
                    let contentDescription = item.name + '(' + '1.0' + ')';

                    recordToEdit.setCurrentSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagedescr',
                        value: contentDescription
                    });
                    log.debug('contentDescription', contentDescription)

                    // todo
                    // recordToEdit.setSublistValue({
                    //     sublistId: 'package',
                    //     fieldId: 'packagetrackingnumber',
                    //     line: 0,
                    //     value: ''
                    // });

                    // Set other required package fields if needed
                    recordToEdit.setCurrentSublistValue({
                        sublistId: 'package',
                        fieldId: 'packageweight',
                        value: itemDetailLookup[item.id].shippingWeight
                    });
                    recordToEdit.commitLine({sublistId: 'package'});
                    currentLine++
                }

            });

            recordToEdit.save();
            log.debug('Case eSmallParcel Completed', 'Package lines created for kit items');

        }

        function safelyExecute(func, context) {
            try {
                return func(context)
            } catch (e) {
                log.error(`error in ${func.name}`, e.toString())
            }
        }

        return {
            afterSubmit: (context) => safelyExecute(afterSubmit, context),
        }
    })

