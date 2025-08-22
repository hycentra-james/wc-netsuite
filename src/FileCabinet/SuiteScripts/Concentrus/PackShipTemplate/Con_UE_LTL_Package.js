/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/http', 'SuiteScripts/Concentrus/Library/Con_Lib_Record_Helper.js'],
    function (record, search, http, recordHelper) {

        const LTL_SHIP_IDS = ['13540', '13656', '10443', '6', '7', '3794', '8', '11391', '9505', '13528', '7730', '7747', '8775', '9608', '7853', '9815', '9', '11078', '10856', '3800', '10', '10336', '7123', '10754', '6720', '10126', '7227', '10644', '11', '12', '13', '8881', '9496', '9811', '3904', '8880', '9606', '3787', '3771', '10752', '10751', '3803', '13219', '18', '11597', '11596', '3774', '24', '7729', '8991', '8776', '9809', '11709', '10019', '25', '6618', '26', '27', '28', '29', '9502', '9500', '9501', '8669', '30', '10123', '3909', '6719', '9193', '7731', '9503', '8989', '31', '10128', '8164', '3801', '7745', '13218', '32', '3788', '10124', '33', '3770', '34', '3769', '8165', '35', '10749', '10750', '9607', '13537', '36', '8990', '10965', '10122', '3753', '8882', '8267', '10020', '37', '7732', '8266', '38', '10442', '3775', '7226', '10755', '39', '10125', '11071', '42', '44', '3766', '7733', '7954', '7849', '10127', '45', '46', '47'];

        function afterSubmit(context) {
            log.debug('context.type', context.type)
            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.XEDIT &&
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            // Replace 'custbody_your_custom_field' with your actual custom field ID
            let customFieldId = 'custbody_pro_number';

            let newRecord = context.newRecord;
            let oldRecord = context.oldRecord;

            // Get the current value of the custom field
            let newValue = newRecord.getValue({
                fieldId: customFieldId
            });

            // Get the previous value (will be null for CREATE operations)
            let oldValue = null;
            if (oldRecord) {
                oldValue = oldRecord.getValue({
                    fieldId: customFieldId
                });
            }

            // Check if field was updated from empty to having a value
            let wasEmpty = !oldValue || oldValue === '' || oldValue === null;
            let hasValue = newValue && newValue !== '' && newValue !== null;

            log.debug('values', {oldValue, newValue, wasEmpty, hasValue})
            if (wasEmpty && hasValue) {
                log.debug({
                    title: 'Pro Number Updated',
                    details: 'Field ' + customFieldId + ' changed from empty to: ' + newValue
                });

                // Make HTTP request
                // makeHttpRequest(newRecord.id);
                updatePackage(newRecord.id);
            }
        }

        function updatePackage(salesOrderId) {
            let searchObj = search.create({
                type: 'itemfulfillment',
                filters: [
                    ['type', 'anyof', 'ItemShip'],
                    "AND",
                    ['createdfrom', 'anyof', salesOrderId],
                    "AND",
                    ['mainline', 'is', 'T']
                ],
                columns: [
                    {name: 'internalid'}
                ]
            });
            let searchResultCount = searchObj.runPaged().count;
            log.debug("searchObj result count", searchResultCount);
            let results = [];
            searchObj.run().each(function (result) {
                results.push(result.id);
                return true;
            });
            if (results.length === 0) {
                throw new Error('No item fulfillment found for sales order ' + salesOrderId);
            }
            let itemFulfillmentId = results[0]
            let recordToEdit = record.load({
                type: record.Type.ITEM_FULFILLMENT,
                id: itemFulfillmentId
            })
            let shipMethod = recordToEdit.getValue('shipmethod');
            let shipMethodId = shipMethod.toString();
            log.debug('shipMethodId', shipMethodId)
            if (LTL_SHIP_IDS.indexOf(shipMethodId) === -1) {
                log.debug('shipMethodId', `${shipMethodId} is not in LTL SHIP ID`)
                return
            }
            let result = processCaseLtl(recordToEdit)
            log.debug('result', result)
        }

        function processCaseLtl(fulfillmentRecord) {
            let items = recordHelper.foreachSublist(fulfillmentRecord, 'item', ['item', 'quantity', 'itemtype', 'itemname', 'kitmemberof'])
                .map(item => {
                    return {
                        id: item.item,
                        name: item.itemname,
                        quantity: item.quantity,
                        type: item.itemtype,
                        kitMemberOf: item.kitmemberof,
                    }
                })
            let itemDetailLookup = getItemDetail(items.map(item => item.id));
            log.debug('items', items)
            if (items.length === 0) {
                log.debug('Case LTL', 'No kit items found');
                return {result: 'No kit items found', updated: false};
            }

            // Load record for editing
            if (isSentToDeposco(fulfillmentRecord)) {
                return {result: 'Item fulfillment sent to Deposco', updated: false};
            }
            let salesOrderId = fulfillmentRecord.getValue({
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
            let packageCount = fulfillmentRecord.getLineCount('package');
            let i
            for (i = packageCount - 1; i >= 0; i--) {
                fulfillmentRecord.removeLine({
                    sublistId: 'package',
                    line: i
                });
            }

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
                    fulfillmentRecord.insertLine({
                        sublistId: 'package',
                        line: 0
                    });

                    let contentDescription = item.name + '(1.0)';

                    fulfillmentRecord.setSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagedescr',
                        line: 0,
                        value: contentDescription
                    });

                    fulfillmentRecord.setSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagetrackingnumber',
                        line: 0,
                        value: proNumber
                    });

                    // Set other required package fields if needed
                    fulfillmentRecord.setSublistValue({
                        sublistId: 'package',
                        fieldId: 'packageweight',
                        line: 0,
                        value: itemDetailLookup[item.id].shippingWeight // Default weight, adjust as needed
                    });
                }
            });

            fulfillmentRecord.save();
            log.debug('Case LTL Completed', 'Package lines updated for ' + items.length + ' kit items');
            return {result: 'Package lines updated', updated: true};
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

        function isSentToDeposco(fulfillmentRecord) {
            let sentToDeposco = fulfillmentRecord.getValue({
                fieldId: 'custbody_deposco_pulled'
            });
            return false && sentToDeposco;
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
