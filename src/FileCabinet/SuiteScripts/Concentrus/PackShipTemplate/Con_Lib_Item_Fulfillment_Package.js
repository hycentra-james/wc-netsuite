/**
 * @NApiVersion 2.1
 */
define(['N/record', 'N/search', 'SuiteScripts/Concentrus/Library/Con_Lib_Record_Helper.js'],
    function (record, search, recordHelper) {

        const SMALL_PARCEL_SHIP_IDS = ['13654', '14074', '14075', '3', '15', '3786', '16', '3783', '17', '19', '20', '22', '3785', '23', '3784', '40', '3778', '3779', '41', '4', '43', '3780', '8988', '3776', '3777', '44', '3766'];
        const LTL_SHIP_IDS = ['13540', '13656', '10443', '6', '7', '3794', '8', '11391', '9505', '13528', '7730', '7747', '8775', '9608', '7853', '9815', '9', '11078', '10856', '3800', '10', '10336', '7123', '10754', '6720', '10126', '7227', '10644', '11', '12', '13', '8881', '9496', '9811', '3904', '8880', '9606', '3787', '3771', '10752', '10751', '3803', '13219', '18', '11597', '11596', '3774', '24', '7729', '8991', '8776', '9809', '11709', '10019', '25', '6618', '26', '27', '28', '29', '9502', '9500', '9501', '8669', '30', '10123', '3909', '6719', '9193', '7731', '9503', '8989', '31', '10128', '8164', '3801', '7745', '13218', '32', '3788', '10124', '33', '3770', '34', '3769', '8165', '35', '10749', '10750', '9607', '13537', '36', '8990', '10965', '10122', '3753', '8882', '8267', '10020', '37', '7732', '8266', '38', '10442', '3775', '7226', '10755', '39', '10125', '11071', '42', '44', '3766', '7733', '7954', '7849', '10127', '45', '46', '47', '14078', '14181', '14482'];

        const SHIP_TYPE = {
            SMALL_PARCEL: '1',
            LTL: '2',
        }
        function processCaseSmallParcel(fulfillmentId) {
            log.debug('fulfillmentId', fulfillmentId)
            let recordToEdit = record.load({
                type: record.Type.ITEM_FULFILLMENT,
                id: fulfillmentId,
                isDynamic: true,
            });

            // DEBUG: Log original package lines before processing
            let originalPackageCount = recordToEdit.getLineCount({sublistId:'package'});
            log.debug('PACKAGE_DEBUG', 'Original package count: ' + originalPackageCount);
            for (let p = 0; p < originalPackageCount; p++) {
                let originalDesc = recordToEdit.getSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagedescr',
                    line: p
                });
                let originalWeight = recordToEdit.getSublistValue({
                    sublistId: 'package',
                    fieldId: 'packageweight',
                    line: p
                });
                let originalTracking = recordToEdit.getSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagetrackingnumber',
                    line: p
                });

                // Update the carton number name for process later
                recordToEdit.selectLine({
                    sublistId: 'package',
                    line: p
                });
                
                log.debug('BEFORE COMMITT packagecartonnumber_' + p, 'packagecartonnumber: ' + recordToEdit.getSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagecartonnumber',
                    line: p
                }));
                recordToEdit.setCurrentSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagecartonnumber',
                    value: originalDesc
                });
                recordToEdit.commitLine({sublistId: 'package'});
                log.debug('AFTER COMMITT packagecartonnumber_' + p, 'packagecartonnumber: ' + recordToEdit.getSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagecartonnumber',
                    line: p
                }));

                
                log.debug('ORIGINAL_PACKAGE_' + p, 'Desc: "' + originalDesc + '", Weight: ' + originalWeight + ', Tracking: ' + originalTracking);
            }
            let items = recordHelper.foreachSublist(recordToEdit, 'item', ['item', 'quantity', 'itemtype', 'itemname', 'kitmemberof'])
                .map(item => {
                    return {
                        id: item.item,
                        name: item.itemname,
                        quantity: item.quantity,
                        type: item.itemtype,
                        kitMemberOf: item.kitmemberof,
                    }
                })

            // DEBUG: Log all Item Fulfillment line items with kit relationships
            log.debug('ITEM_DEBUG', 'Total Item Fulfillment lines: ' + items.length);
            items.forEach((item, index) => {
                log.debug('ITEM_LINE_' + index, 'ID: ' + item.id + ', Name: "' + item.name + '", Qty: ' + item.quantity + 
                         ', Type: ' + item.type + ', KitMemberOf: ' + (item.kitMemberOf || 'NONE'));
            });

            let itemDetailLookup = getItemDetail(items.map(item => item.id));
            log.debug('items', items)
            
            // DEBUG: Log item details lookup results
            log.debug('ITEM_DETAIL_DEBUG', 'Item detail lookup results:');
            Object.keys(itemDetailLookup).forEach(itemId => {
                let detail = itemDetailLookup[itemId];
                log.debug('ITEM_DETAIL_' + itemId, 'NumberOfBoxes: ' + detail.numberOfBoxes + 
                         ', ShippingWeight: ' + detail.shippingWeight + ', ShipType: ' + detail.shipType);
            });
            if (items.length === 0) {
                log.debug('Case eSmallParcel', 'No kit items found');
                return;
            }

            if (isSentToDeposco(recordToEdit)) {
                return
            }

            // Create one package line per unit quantity of each kit item
            let currentLine = 0
            // check stage
            log.debug('CALCULATION_DEBUG', 'Starting package line calculation...');
            items.map(function (item) {
                if (item.kitMemberOf) {
                    log.debug('CALC_SKIP_MEMBER', 'Skipping kit member: ' + item.name + ' (member of: ' + item.kitMemberOf + ')');
                    return
                }
                let numberOfBoxes, quantity, totalQuantity
                try {
                    numberOfBoxes = itemDetailLookup[item.id].numberOfBoxes;
                } catch (e) {
                    numberOfBoxes = 1;
                }
                quantity = item.quantity;
                totalQuantity = Number(quantity) * Number(numberOfBoxes);
                log.debug('CALC_ITEM_' + item.id, 'Item: ' + item.name + ', Qty: ' + quantity + 
                         ', NumberOfBoxes: ' + numberOfBoxes + ', TotalQuantity: ' + totalQuantity);
                currentLine += totalQuantity;
            })
            let packageLines = recordToEdit.getLineCount({sublistId:'package'});
            log.debug('PACKAGE_COUNT_CHECK', 'Expected package lines: ' + currentLine + ', Actual package lines: ' + packageLines);
            if (packageLines !== currentLine) {
                log.audit('package lines number is not as expected', {packageLines, currentLine})
            }

            currentLine = 0
            log.debug('ASSIGNMENT_DEBUG', 'Starting package line assignment...');
            items.forEach(function (item) {
                log.debug('items item', item)
                log.debug('currentLine', currentLine)
                if (item.kitMemberOf) {
                    log.debug('ASSIGN_SKIP_MEMBER', 'Skipping kit member: ' + item.name + ' (member of: ' + item.kitMemberOf + ')');
                    // member item should not be listed
                    return
                }
                let numberOfBoxes, quantity, totalQuantity
                try {
                    numberOfBoxes = itemDetailLookup[item.id].numberOfBoxes;
                } catch (e) {
                    numberOfBoxes = 1;
                }
                let numberOfBoxesIsOne = true
                if (numberOfBoxes > 1) {
                    numberOfBoxesIsOne = false
                }
                quantity = item.quantity;
                totalQuantity = Number(quantity) * Number(numberOfBoxes);
                
                log.debug('ASSIGN_ITEM_START', 'Processing item: ' + item.name + ' (ID: ' + item.id + ')');
                log.debug('ASSIGN_ITEM_PARAMS', 'Qty: ' + quantity + ', NumberOfBoxes: ' + numberOfBoxes + 
                         ', TotalQuantity: ' + totalQuantity + ', Starting at currentLine: ' + currentLine);
                
                for (let i = 0; i < totalQuantity; i++) {
                    log.debug('ASSIGN_PACKAGE_' + currentLine, 'Assigning to package line ' + currentLine + ' (loop iteration ' + i + ')');
                    
                    // Create individual package lines for each unit
                    recordToEdit.selectLine({
                        sublistId: 'package',
                        line: currentLine
                    });

                    // Get original description before overwriting
                    let originalDesc = recordToEdit.getCurrentSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagedescr'
                    });

                    // let qty = carton.packShipTotalPackedQty.toFixed(1);
                    let contentDescription = item.name + '(' + '1.0' + ')';

                    log.debug('ASSIGN_DESC_CHANGE', 'Package line ' + currentLine + ': "' + originalDesc + '" → "' + contentDescription + '"');

                    recordToEdit.setCurrentSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagedescr',
                        value: contentDescription
                    });

                    if (numberOfBoxesIsOne) { // only when umberOfBoxes is 1, we change the shipping weight
                        let newWeight = itemDetailLookup[item.id].shippingWeight;
                        log.debug('ASSIGN_WEIGHT_CHANGE', 'Package line ' + currentLine + ': Setting weight to ' + newWeight);
                        recordToEdit.setCurrentSublistValue({
                            sublistId: 'package',
                            fieldId: 'packageweight',
                            value: newWeight
                        });
                    } else {
                        log.debug('ASSIGN_WEIGHT_SKIP', 'Package line ' + currentLine + ': Skipping weight change (numberOfBoxes > 1)');
                    }
                    recordToEdit.commitLine({sublistId: 'package'});
                    currentLine++
                }
                log.debug('ASSIGN_ITEM_END', 'Completed item: ' + item.name + ', currentLine now: ' + currentLine);
            });

            // DEBUG: Log final package lines before saving
            let finalPackageCount = recordToEdit.getLineCount({sublistId:'package'});
            log.debug('FINAL_PACKAGE_DEBUG', 'Final package count before save: ' + finalPackageCount);
            for (let f = 0; f < finalPackageCount; f++) {
                recordToEdit.selectLine({
                    sublistId: 'package',
                    line: f
                });
                let finalDesc = recordToEdit.getCurrentSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagedescr'
                });
                let finalWeight = recordToEdit.getCurrentSublistValue({
                    sublistId: 'package',
                    fieldId: 'packageweight'
                });
                let finalTracking = recordToEdit.getCurrentSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagetrackingnumber'
                });
                log.debug('FINAL_PACKAGE_' + f, 'Desc: "' + finalDesc + '", Weight: ' + finalWeight + ', Tracking: ' + finalTracking);
            }

            recordToEdit.save();
            log.debug('Case eSmallParcel Completed', 'Package lines created for kit items');
        }

        function processFullSmallParcel(fulfillmentId, shipMethodId) {
            if (SMALL_PARCEL_SHIP_IDS.indexOf(shipMethodId) !== -1) {
                log.debug('Case SmallParcel Triggered', 'Ship method in SMALL_PARCEL_SHIP_IDS')
                processCaseSmallParcel(fulfillmentId);
            }
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
                let itemShipType = itemDetailLookup[item.id].shipType
                let numberOfBoxes = itemDetailLookup[item.id].numberOfBoxes
                if (itemShipType === SHIP_TYPE.SMALL_PARCEL) { // special case when LTL shipment contains small parcel items
                    numberOfPackages = 1
                }

                let q;
                for (q = 0; q < numberOfPackages; q++) {
                    fulfillmentRecord.insertLine({
                        sublistId: 'package',
                        line: 0
                    });

                    let contentDescription;
                    if (item.name + itemShipType === SHIP_TYPE.SMALL_PARCEL) {
                        contentDescription = `${item.name}(${numberOfBoxes}.0`;
                    } else {
                        contentDescription = item.name + '(1.0)';
                    }

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

        function processFullLtl(fulfillmentId, shipMethodId) {
            let recordToEdit = record.load({
                type: record.Type.ITEM_FULFILLMENT,
                id: fulfillmentId
            })
            if(!shipMethodId) {
                let shipMethod = recordToEdit.getValue('shipmethod');
                shipMethodId = shipMethod.toString();
                log.debug('shipMethodId', shipMethodId)
            }
            if (LTL_SHIP_IDS.indexOf(shipMethodId) === -1) {
                log.debug('shipMethodId', `${shipMethodId} is not in LTL SHIP ID`)
                return
            }
            let result = processCaseLtl(recordToEdit)
            log.debug('result', result)
        }

        function isSentToDeposco(fulfillmentRecord) {
            let sentToDeposco = fulfillmentRecord.getValue({
                fieldId: 'custbody_deposco_pulled'
            });
            return false && sentToDeposco;
        }

        function getItemDetail(items) {
            let searchObj = search.create({
                type: 'item',
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
                    {name: 'custitem_fmt_pallet_quantity'},
                    {name: 'custitem_fmt_no_boxes'},
                    {name: 'custitem_fmt_ship_type'},
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
                    palletQuantity: Number(result.getValue({name: 'custitem_fmt_pallet_quantity'})),
                    numberOfBoxes: Number(result.getValue({name: 'custitem_fmt_no_boxes'})),
                    shipType: result.getValue({name: 'custitem_fmt_ship_type'}),
                };
                return true;
            });
            return results;
        }

        function safelyExecute(func, context) {
            try {
                return func(context)
            } catch (e) {
                log.error(`error in ${func.name}`, e.toString())
            }
        }

        function getLtlShipMethodIds() {
            return LTL_SHIP_IDS;
        }

        return {
            processCaseSmallParcel: (context) => safelyExecute(processCaseSmallParcel, context),
            processFullSmallParcel,
            processCaseLtl,
            processFullLtl,
            isSentToDeposco,
            getItemDetail,
            getLtlShipMethodIds,
        }
    })
