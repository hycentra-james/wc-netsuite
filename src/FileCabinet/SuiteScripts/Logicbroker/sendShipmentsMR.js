/**
* @NApiVersion 2.1
* @NScriptType MapReduceScript
* @NModuleScope Public
*/

define (['N/runtime', 'N/record', 'N/search', './suppHelper'],
    function (runtime, record, search, helper) {
        /**
         * Find all item fulfillments ready to be exported as shipments
         *
         * @returns {array} The internal IDs of all shipments to be exported
         */
        function getShipments() {
            var apiKey = helper.getApiKey();
            var apiUrl = helper.getApiUrl();
            if (apiKey == null || apiUrl == null) {
                log.error({
                    title: 'PARAMETER ERROR',
                    details: 'Please configure the API Key and/or Endpoint in company preferences.'
                });
                return;
            }
            if (helper.isProduction() && runtime.envType != 'PRODUCTION') {
                log.error({
                    title: 'PARAMETER ERROR',
                    details: 'Cannot use Production endpoint outside of production account. '
                        + 'Please change the API Endpoint to Stage in company preferences.'
                });
                return;
            }
            var excluded = helper.getExcludedCustomers();
            var useLBPackages = helper.useLogicbrokerPackages();
            var filters = [
                ['type','is','ItemShip'],
                'AND',
                ['custbody_lb_orderlbkey','isnotempty',''],
                'AND',
                ['custbodylb_exportstatus','is','3'],
                'AND',
                ['mainline', 'is', 'T']
            ];
            if (excluded.length > 0) {
                filters = filters.concat(['AND', ['customer.internalid', 'noneof', excluded]]);
            }
            if (useLBPackages) {
                filters = filters.concat(['AND', ['custrecord_lbsupp_itemfulfillment.custrecord_lbsupp_containertracknum','isnotempty', '']]);
            } else {
                filters = filters.concat(['AND', ['trackingnumber','isnotempty', '']]);
            }

            return search.create({
                type: search.Type.TRANSACTION,
                columns: [
                    { name: 'internalid' }
                ],
                filters: filters
            });
        }

        function map(context) {
            var searchResult = JSON.parse(context.value);
            var id = searchResult.id;
            var apiUrl = helper.getApiUrl();
            var useLBPackages = helper.useLogicbrokerPackages();
            context.write(id, id);
            // Load up the item fulfillment and sales order records
            try {
                var itemfulfill = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: id,
                    isDynamic: true
                });
            } catch (e) {
                log.error({
                    title: 'LOADING ERROR',
                    details: 'Could not load Item Fulfillment ' + id + ': ' + e.message
                });
                return;
            }
            var tranId = itemfulfill.getValue({ fieldId: 'tranid' });
            var orderLbKey = itemfulfill.getValue({ fieldId: 'custbody_lb_orderlbkey' });
            var soId = itemfulfill.getValue({ fieldId: 'createdfrom' });
            if (!soId) {
                var soidError = 'Item Fulfillment ' + tranId + ' was not created off of a sales order (createdfrom field empty) in NetSuite and therefore cannot be exported.';
                log.error({
                    title: 'NO ASSOCIATED SO',
                    details: soidError
                });
                helper.createFailedExportEvent(apiUrl, 'shipment', tranId, null, orderLbKey, soidError);
                itemfulfill.setValue({
                    fieldId: 'custbodylb_exportstatus',
                    value: 2
                });
                try {
                    itemfulfill.save();
                } catch (e) {
                    msg = 'Error saving item fulfillment ' + tranId + ' in NetSuite: ' + e.message;
                    log.error({
                        title: 'SAVE ERROR',
                        details: msg
                    });
                }
                return;
            }

            var soFields = getSOFields(soId);

            var lbship = {
                ShipmentNumber: tranId,
                ShipmentLines: getShipLines(itemfulfill),
                OrderNumber: soFields.tranid,
                PartnerPO: soFields.otherrefnum,
                ShipmentInfos: [],
                ShipToAddress: getAddress(itemfulfill, 'ship'),
                BillToAddress: soFields.BillToAddress,
                ShipFromAddress: getShipFrom(itemfulfill),
                ExtendedAttributes: []
            };

            // Set Header KVPs
            setExtendedData(lbship.ExtendedAttributes, 'internalOrderId', soId);
            setExtendedData(lbship.ExtendedAttributes, 'internalShipmentId', id);

            if (!useLBPackages) {
                var pkgCount = (itemfulfill.getLineCount({ sublistId: 'package' }) === -1 ? 0 : itemfulfill.getLineCount({ sublistId: 'package' }))
                + (itemfulfill.getLineCount({ sublistId: 'packagefedex' }) === -1 ? 0 : itemfulfill.getLineCount({ sublistId: 'packagefedex' }))
                + (itemfulfill.getLineCount({ sublistId: 'packageups' }) === -1 ? 0 : itemfulfill.getLineCount({ sublistId: 'packageups' }))
                + (itemfulfill.getLineCount({ sublistId: 'packageusps' })=== -1 ? 0 : itemfulfill.getLineCount({ sublistId: 'packageusps' }));
                if (pkgCount > 1) {
                    var shipMethod = itemfulfill.getText({ fieldId: 'shipmethod' });
                    shipMethod = shipMethod.replace(/[^a-zA-Z0-9-_ ]/g, '');

                    for (var i = 0; i < itemfulfill.getLineCount({ sublistId: 'package' }); i++) {
                        itemfulfill.selectLine({ sublistId: 'package', line: i });
                        var trackNum = itemfulfill.getCurrentSublistValue({ sublistId: 'package', fieldId: 'packagetrackingnumber' });
                        var weight = itemfulfill.getCurrentSublistValue({ sublistId: 'package', fieldId: 'packageweight' });
                        var descr = itemfulfill.getCurrentSublistValue({ sublistId: 'package', fieldId: 'packagedescr' });
                        lbship.ShipmentInfos.push({
                            TrackingNumber: trackNum,
                            ClassCode: shipMethod,
                            Weight: weight,
                            Note: descr
                        });
                    }
                    for (var i = 0; i < itemfulfill.getLineCount({ sublistId: 'packagefedex' }); i++) {
                        itemfulfill.selectLine({ sublistId: 'packagefedex', line: i });
                        var trackNum = itemfulfill.getCurrentSublistValue({ sublistId: 'packagefedex', fieldId: 'packagetrackingnumberfedex' });
                        var weight = itemfulfill.getCurrentSublistValue({ sublistId: 'packagefedex', fieldId: 'packageweightfedex' });
                        var descr = itemfulfill.getCurrentSublistValue({ sublistId: 'package', fieldId: 'reference1fedex' });
                        lbship.ShipmentInfos.push({
                            TrackingNumber: trackNum,
                            ClassCode: shipMethod,
                            Weight: weight,
                            Note: descr
                        });
                    }
                    for (var i = 0; i < itemfulfill.getLineCount({ sublistId: 'packageups' }); i++) {
                        itemfulfill.selectLine({ sublistId: 'packageups', line: i });
                        var trackNum = itemfulfill.getCurrentSublistValue({ sublistId: 'packageups', fieldId: 'packagetrackingnumberups' });
                        var weight = itemfulfill.getCurrentSublistValue({ sublistId: 'packageups', fieldId: 'packageweightups' });
                        var descr = itemfulfill.getCurrentSublistValue({ sublistId: 'package', fieldId: 'packagedescrups' });
                        lbship.ShipmentInfos.push({
                            TrackingNumber: trackNum,
                            ClassCode: shipMethod,
                            Weight: weight,
                            Note: descr
                        });
                    }
                    for (var i = 0; i < itemfulfill.getLineCount({ sublistId: 'packageusps' }); i++) {
                        itemfulfill.selectLine({ sublistId: 'packageusps', line: i });
                        var trackNum = itemfulfill.getCurrentSublistValue({ sublistId: 'packageusps', fieldId: 'packagetrackingnumberusps' });
                        var weight = itemfulfill.getCurrentSublistValue({ sublistId: 'packageusps', fieldId: 'packageweightusps' });
                        var descr = itemfulfill.getCurrentSublistValue({ sublistId: 'package', fieldId: 'packagedescrusps' });
                        lbship.ShipmentInfos.push({
                            TrackingNumber: trackNum,
                            ClassCode: shipMethod,
                            Weight: weight,
                            Note: descr
                        });
                    }
                }
            }

            // Add on all custom fields as Extended Attributes
            var custFields = helper.getCustBodyFields(itemfulfill);
            custFields.forEach(function (fieldName) {
                var fieldVal = itemfulfill.getValue({ fieldId: fieldName });
                if (fieldVal !== null && fieldVal !== '') {
                    if(typeof fieldVal == 'object') {
                        fieldVal = JSON.stringify(fieldVal);
                    }
                    setExtendedData(lbship.ExtendedAttributes, fieldName, fieldVal);
                }
            });

            try {
                // Post to Logicbroker
                var url = apiUrl + 'api/v1/Shipments';
                var ret = helper.postToApi(url, JSON.stringify(lbship), ['Body']);
                if (ret.Result.hasOwnProperty('LogicbrokerKey')) {
                    var portalUrl = helper.isProduction() ? 'https://portal.logicbroker.com' : 'https://stageportal.logicbroker.com'
                    itemfulfill.setValue({
                        fieldId: 'custbody_lb_shiplbkey',
                        value: ret.Result.LogicbrokerKey
                    });
                    itemfulfill.setValue({
                        fieldId: 'custbody_lb_shippinglabel',
                        value: portalUrl + '/areas/logicbroker/shippinglabel.ashx?logicbrokerkeys=' + ret.Result.LogicbrokerKey + '&filetype=pdf&viewinbrowser=true'
                    });
                }
                itemfulfill.setValue({
                    fieldId: 'custbodylb_exportstatus',
                    value: 1
                });
                log.debug({
                    title: 'ITEM FULFILLMENT EXPORTED',
                    details: 'Item Fulfillment ' + tranId + ' was successfully exported to Logicbroker.'
                });
                itemfulfill.save();
            } catch (e) {
                var msg = '';
                var dupMatch = 'This shipment already exists';
                var changedMatch = 'Record has been changed';
                var hostMatch = 'The host you are trying to connect to is not responding';
                if (e.message.indexOf(dupMatch) !== -1) {
                    var lbkey = getLogicbrokerKey(e.message);
                    msg = 'Item fulfillment ' + tranId + ' has a duplicate in Logicbroker and was not exported again.';
                    log.error({
                        title: 'EXPORT ERROR',
                        details: msg
                    });
                    itemfulfill.setValue({
                        fieldId: 'custbody_lb_shiplbkey',
                        value: lbkey
                    });
                    itemfulfill.setValue({
                        fieldId: 'custbodylb_exportstatus',
                        value: 1
                    });
                    itemfulfill.setValue({
                        fieldId: 'custbody_lb_errormsg',
                        value: msg
                    });
                    try {
                        itemfulfill.save();
                    } catch (err) {
                        msg = 'Error saving item fulfillment ' + tranId + ' in NetSuite: ' + err.message;
                        log.error({
                            title: 'SAVE ERROR',
                            details: msg
                        });
                    }
                } else if (e.message.indexOf(changedMatch) !== -1) {
                    msg = 'Error saving item fulfillment ' + tranId + ' in NetSuite: ' + e.message;
                    log.error({
                        title: 'SAVE ERROR',
                        details: msg
                    });
                } else if (e.message.indexOf(hostMatch) !== -1) {
                    msg = 'Error sending item fulfillment ' + tranId + ' to Logicbroker: ' + e.message;
                    log.error({
                        title: 'EXPORT ERROR',
                        details: msg
                    });
                    itemfulfill.setValue({
                        fieldId: 'custbody_lb_errormsg',
                        value: msg
                    });
                    try {
                        itemfulfill.save();
                    } catch (err) {
                        msg = 'Error saving item fulfillment ' + tranId + ' in NetSuite: ' + err.message;
                        log.error({
                            title: 'SAVE ERROR',
                            details: msg
                        });
                    }
                } else {
                    msg = 'Error exporting item fulfillment ' + tranId + ' to Logicbroker: ' + e.message;
                    log.error({
                        title: 'EXPORT ERROR',
                        details: msg
                    });
                    helper.createFailedExportEvent(apiUrl, 'shipment', tranId, lbship, orderLbKey, msg);
                    itemfulfill.setValue({
                        fieldId: 'custbodylb_exportstatus',
                        value: 2
                    });
                    itemfulfill.setValue({
                        fieldId: 'custbody_lb_errormsg',
                        value: msg
                    });
                    try {
                        itemfulfill.save();
                    } catch (err) {
                        msg = 'Error saving item fulfillment ' + tranId + ' in NetSuite: ' + err.message;
                        log.error({
                            title: 'SAVE ERROR',
                            details: msg
                        });
                    }
                }
            }
        }

        function summarize(context) {
            var totalItemsProcessed = 0;
            context.output.iterator().each(function (key, value) {
                totalItemsProcessed++;
                return true;
            });
            var summaryMessage = "Usage: " + context.usage + " Concurrency: " + context.concurrency +
                " Number of yields: " + context.yields + " Total orders processed: " + totalItemsProcessed;
            log.audit({ title: 'Summary of usage', details: summaryMessage });
        }

        /**
         * Gets all necessary fields off of the sales order
         *
         * @param {string} soId The internal ID of the sales order
         * @returns {Object} A JSON object with the tranid, otherrefnum and billingaddress
         */
        function getSOFields(soId) {
            var soFields = {};
            var soSearch = search.create({
                type: search.Type.SALES_ORDER,
                filters:
                [
                   ['type','anyof','SalesOrd'],
                   'AND',
                   ['internalid','anyof', soId],
                   'AND',
                   ['mainline','is','T']
                ],
                columns:
                [
                    search.createColumn({name: 'tranid'}),
                    search.createColumn({name: 'otherrefnum'}),
                    search.createColumn({
                        name: 'attention',
                        join: 'billingAddress'
                    }),
                    search.createColumn({
                        name: 'addressee',
                        join: 'billingAddress'
                    }),
                    search.createColumn({
                        name: 'address1',
                        join: 'billingAddress'
                    }),
                    search.createColumn({
                        name: 'address2',
                        join: 'billingAddress'
                    }),
                    search.createColumn({
                        name: 'city',
                        join: 'billingAddress'
                    }),
                    search.createColumn({
                        name: 'state',
                        join: 'billingAddress'
                    }),
                    search.createColumn({
                        name: 'zip',
                        join: 'billingAddress'
                    }),
                    search.createColumn({
                        name: 'country',
                        join: 'billingAddress'
                    }),
                    search.createColumn({
                        name: 'phone',
                        join: 'billingAddress'
                    })
                ]
                }).run().getRange({ start: 0, end: 1 });
                if (soSearch.length > 0) {
                    soFields = {
                        tranid: soSearch[0].getValue({ name: 'tranid' }),
                        otherrefnum: soSearch[0].getValue({ name: 'otherrefnum' }),
                        BillToAddress: {
                            CompanyName: soSearch[0].getValue({ name: 'addressee', join: 'billingAddress' }),
                            Address1: soSearch[0].getValue({ name: 'address1', join: 'billingAddress' }),
                            Address2: soSearch[0].getValue({ name: 'address2', join: 'billingAddress' }),
                            City: soSearch[0].getValue({ name: 'city', join: 'billingAddress' }),
                            State: soSearch[0].getValue({ name: 'state', join: 'billingAddress' }),
                            Country: soSearch[0].getValue({ name: 'country', join: 'billingAddress' }),
                            Zip: soSearch[0].getValue({ name: 'zip', join: 'billingAddress' }),
                            Phone: soSearch[0].getValue({ name: 'phone', join: 'billingAddress' }),
                            ExtendedAttributes: [
                                {
                                    Name: 'addressee',
                                    Value: soSearch[0].getValue({ name: 'addressee', join: 'billingAddress' })
                                },
                                {
                                    Name: 'attention',
                                    Value: soSearch[0].getValue({ name: 'attention', join: 'billingAddress' })
                                }
                            ]
                        }
                    };
                }
                return soFields;
        }

        /**
         * Create the ShipmentLines from an item fulfillment record
         *
         * @param {ItemFulfillment} itemfulfill The item fulfillment record
         * @returns {array} The array of ShipmentLines
         */
        function getShipLines(itemfulfill) {
            var shipLines = [];
            var lineCount = itemfulfill.getLineCount({ sublistId: 'item' });

            for (var i = 0; i < lineCount; i++) {
                itemfulfill.selectLine({ sublistId: 'item', line: i });
                var sku = itemfulfill.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_lbret_itemid' });
                var description = itemfulfill.getCurrentSublistValue({ sublistId: 'item', fieldId: 'description' });
                var qty = itemfulfill.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' });
                var lineNum = itemfulfill.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_lb_linenum' })
                    || itemfulfill.getCurrentSublistValue({ sublistId: 'item', fieldId: 'orderline' });
                var shipLine = {
                    ItemIdentifier: {
                        SupplierSKU: sku
                    },
                    Description: description || '',
                    LineNumber: lineNum,
                    Quantity: qty,
                    ExtendedAttributes: [],
                    ShipmentInfos: []
                };

                // Add on all custom line-level fields as Extended Attributes
                var custFields = helper.getCustLineFields(itemfulfill);
                custFields.forEach(function (fieldName) {
                	var fieldVal = itemfulfill.getCurrentSublistValue({ sublistId: 'item', fieldId: fieldName });
                	if (fieldVal !== null && fieldVal !== '') {
                		if(typeof fieldVal == 'object') {
                			fieldVal = JSON.stringify(fieldVal);
                		}
                		setExtendedData(shipLine.ExtendedAttributes, fieldName, fieldVal);
                	}
                });

                shipLines.push(shipLine);
            }
            addShipmentInfos(itemfulfill, shipLines);
            return shipLines;
        }

        /**
		 * Converts the packages into ShipmentInfos
		 *
		 * @param {Record} itemfulfill The Item Fulfillment
         * @param {Array} shipLines The lines on the LB shipment
		 */
        function addShipmentInfos(itemfulfill, shipLines) {
            var useLBPackages = helper.useLogicbrokerPackages();
            if (!useLBPackages) {
                var pkgCount = (itemfulfill.getLineCount({ sublistId: 'package' }) === -1 ? 0 : itemfulfill.getLineCount({ sublistId: 'package' }))
                + (itemfulfill.getLineCount({ sublistId: 'packagefedex' }) === -1 ? 0 : itemfulfill.getLineCount({ sublistId: 'packagefedex' }))
                + (itemfulfill.getLineCount({ sublistId: 'packageups' }) === -1 ? 0 : itemfulfill.getLineCount({ sublistId: 'packageups' }))
                + (itemfulfill.getLineCount({ sublistId: 'packageusps' })=== -1 ? 0 : itemfulfill.getLineCount({ sublistId: 'packageusps' }));
                // If there is more than one package, it will be added at the header level ShipmentInfos, because we do not know which items are in which package
                if (pkgCount === 1) {
                    var shipMethod = itemfulfill.getText({ fieldId: 'shipmethod' });
                    shipMethod = shipMethod.replace(/[^a-zA-Z0-9-_ ]/g, '');

                    // Account for all the package lists
                    var trackNum;
                    var weight;
                    if (itemfulfill.getLineCount({ sublistId: 'package' }) > 0) {
                        trackNum = itemfulfill.getSublistValue({ sublistId: 'package', fieldId: 'packagetrackingnumber', line: 0 });
                        weight = itemfulfill.getSublistValue({ sublistId: 'package', fieldId: 'packageweight', line: 0 });
                    } else if (itemfulfill.getLineCount({ sublistId: 'packagefedex' }) > 0) {
                        trackNum = itemfulfill.getSublistValue({ sublistId: 'packagefedex', fieldId: 'packagetrackingnumberfedex', line: 0 });
                        weight = itemfulfill.getSublistValue({ sublistId: 'packagefedex', fieldId: 'packageweightfedex', line: 0 });
                    } else if (itemfulfill.getLineCount({ sublistId: 'packageups' }) > 0) {
                        trackNum = itemfulfill.getSublistValue({ sublistId: 'packageups', fieldId: 'packagetrackingnumberups', line: 0 });
                        weight = itemfulfill.getSublistValue({ sublistId: 'packageups', fieldId: 'packageweightups', line: 0 });
                    } else if (itemfulfill.getLineCount({ sublistId: 'packageusps' }) > 0) {
                        trackNum = itemfulfill.getSublistValue({ sublistId: 'packageusps', fieldId: 'packagetrackingnumberusps', line: 0 });
                        weight = itemfulfill.getSublistValue({ sublistId: 'packageusps', fieldId: 'packageweightusps', line: 0 });
                    }

                    shipLines.forEach(function (shipLine) {
                        shipLine.ShipmentInfos = [{
                            TrackingNumber: trackNum,
                            Qty: shipLine.Quantity,
                            ClassCode: shipMethod,
                            Weight: weight
                        }];
                    });
                }
            } else {
                var packages = {};
                // First we have to get the list of packages with items under them
                var lineCount = itemfulfill.getLineCount({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment' });
                for (var i = 0; i < lineCount; i++) {
                    itemfulfill.selectLine({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment', line: i });
                    var trackNum = itemfulfill.getCurrentSublistValue({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment', fieldId: 'custrecord_lbsupp_containertracknum' });
                    var weight = itemfulfill.getCurrentSublistValue({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment', fieldId: 'custrecord_lbsupp_containerweight' });
                    var height = itemfulfill.getCurrentSublistValue({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment', fieldId: 'custrecord_lbsupp_containerheight' });
                    var width = itemfulfill.getCurrentSublistValue({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment', fieldId: 'custrecord_lbsupp_containerwidth' });
                    var length = itemfulfill.getCurrentSublistValue({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment', fieldId: 'custrecord_lbsupp_containerlength' });
                    var containerCode = itemfulfill.getCurrentSublistValue({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment', fieldId: 'custrecord_lbsupp_containercode' });
                    var classCode = itemfulfill.getCurrentSublistValue({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment', fieldId: 'custrecord_lbsupp_containerclasscode' });
                    var id = itemfulfill.getCurrentSublistValue({ sublistId: 'recmachcustrecord_lbsupp_itemfulfillment', fieldId: 'id' });

                    packages[id] = {
                        TrackingNumber: trackNum,
                        Weight: weight,
                        Height: height,
                        Width: width,
                        Length: length,
                        ContainerCode: containerCode,
                        ClassCode: classCode,
                        Items: []
                    };
                }
                search.create({
                    type: 'customrecord_lbsupp_containerdetails',
                    columns: [
                        search.createColumn({ name: 'custrecord_lbsupp_container' }),
                        search.createColumn({ name: 'custrecord_lbsupp_containeritemsku' }),
                        search.createColumn({ name: 'custrecord_lbsupp_containerqty' }),
                        //search.createColumn({ name: 'itemid', join: 'CUSTRECORD_LBSUPP_CONTAINERITEMSKU' })
                    ],
                    filters: [
                        //['custrecord_lbsupp_container', 'anyof', Object.keys(packages)]
                        ['custrecord_lbsupp_container.custrecord_lbsupp_itemfulfillment', 'anyof', itemfulfill.getValue({ fieldId: 'id'})]
                    ]
                }).run().each(function (res) {
                    var containerId = res.getValue({ name: 'custrecord_lbsupp_container' });
                    var sku = res.getText({ name: 'custrecord_lbsupp_containeritemsku' });
                    //var sku = res.getText({ name: 'itemid', join: 'custrecord_lbsupp_containeritemsku' });
                    var qty = res.getValue({ name: 'custrecord_lbsupp_containerqty' });
                    packages[containerId].Items.push({
                        sku: sku,
                        qty: qty
                    });
                    return true;
                });

                // Now that we have the packages, we need to turn them into a list of items with packages under them
                /* packageArray: an array of the LB packages from the NS Item Fulfillment
                    Structure:
                    [
                        TrackingNumber: trackNum,
                        Weight: weight,
                        Height: height,
                        Width: width,
                        Length: length,
                        ContainerCode: containerCode,
                        ClassCode: classCode,
                        Items: [
                            sku: sku,
                            qty: qty
                        ]
                    ]
                */
                var packageArray = Object.values(packages);
                /* mappedItemsObj: an object to first gather all items from the shipment with quantites per line
                    the qtyOnLine will decrement and represent REMAINING qty to be allotted to packages
                    Structure:
                    {
                        sku: [
                            indexOnShipment: qtyOnLine
                        ]
                    }
                */
                var mappedItemsObj = {};
                shipLines.forEach(function (shipLine, index) {
                    if (!mappedItemsObj.hasOwnProperty(shipLine.ItemIdentifier.SupplierSKU)) {
                        mappedItemsObj[shipLine.ItemIdentifier.SupplierSKU] = {};
                    }
                    mappedItemsObj[shipLine.ItemIdentifier.SupplierSKU][index] = shipLine.Quantity;
                });
                // Iterate through the array of LB packages
                for (var i = 0; i < packageArray.length; i++) {
                    // Within each package, iterate through the list of Items on the package
                    packageArray[i].Items.forEach(function (item) {
                        if (!mappedItemsObj.hasOwnProperty(item.sku)) {
                            log.error({
                                title: 'SKU NOT FOUND',
                                details: 'Item ' + item.sku + ' was found in a package but is not on shipment ' + itemfulfill.getValue({ fieldId: 'tranid' }) + ', and will not be included.'
                            });
                            return;
                        }
                        var pkgQty = item.qty;
                        var lastLine = Math.max.apply(null, Object.keys(mappedItemsObj[item.sku]));

                        // Find the item entry in mappedItemsObj and iterate over each line it appears on in the shipment
                        Object.keys(mappedItemsObj[item.sku]).forEach(function (lineIndex) {
                            // Remaining quantity to be allotted to packages
                            var lineQty = mappedItemsObj[item.sku][lineIndex];
                            var thisItemQty = Math.min(lineQty, pkgQty); // Either we're filling the full item qty, or the full pkg qty
                            var shipInfos = Object.assign({}, packageArray[i]);
                            delete shipInfos.Items;
                            shipInfos.Qty = thisItemQty;

                            mappedItemsObj[item.sku][lineIndex] -= thisItemQty;
                            pkgQty -= thisItemQty;
                            // Push the shipInfos onto the shipment for LB
                            // If this line is the last instance of the sku and there's still pkgQty, either discard the extra qty or include the new tracking number with 0 qty
                            if (shipInfos.Qty > 0 || (lastLine === parseInt(lineIndex) && pkgQty > 0)) {
                                shipLines[lineIndex].ShipmentInfos.push(shipInfos);
                            }
                        });
                    });
                }
            }
        }

        /**
         * Get shipping or billing address as JSON
         *
         * @param {Transaction} rec The record to pull the address from
         * @param {string} type Either 'bill' or 'ship'
         * @returns {Object} The address in json form
         */
        function getAddress(rec, type) {
            var addr;
            if (type === 'bill') {
                addr = rec.getSubrecord({
                    fieldId: 'billingaddress'
                });
            } else {
                addr = rec.getSubrecord({
                    fieldId: 'shippingaddress'
                });
            }

            // Get all values
            var fullAddr = {
                CompanyName: addr.getValue({ fieldId: 'addressee' }),
                Address1: addr.getValue({ fieldId: 'addr1' }),
                Address2: addr.getValue({ fieldId: 'addr2' }),
                City: addr.getValue({ fieldId: 'city' }),
                State: addr.getValue({ fieldId: 'state' }),
                Country: addr.getValue({ fieldId: 'country' }),
                Zip: addr.getValue({ fieldId: 'zip' }),
                Phone: addr.getValue({ fieldId: 'addrphone' }),
                ExtendedAttributes: [
                    {
                        Name: 'addressee',
                        Value: addr.getValue({ fieldId: 'addressee' })
                    },
                    {
                        Name: 'attention',
                        Value: addr.getValue({ fieldId: 'attention' })
                    }
                ]
            };

            return fullAddr;
        }

        /**
         * Get ship from address as JSON
         *
         * @param {Record} so The item fulfillment record
         * @returns {Object} The address in json form
         */
        function getShipFrom(rec) {
            var locations = [];
            var lineCount = rec.getLineCount({ sublistId: 'item' });

            for (var i = 0; i < lineCount; i++) {
                rec.selectLine({ sublistId: 'item', line: i });
                var loc = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'location' });
                if (loc && locations.indexOf(loc) == -1){
                    locations.push(loc);
                    break;
                }
            }
            if (locations.length !== 1) {
                log.error({
                    title: 'LOCATION ERROR',
                    details: 'Could not determine Ship From address from line items.'
                });
                return {};
            }
            var locSearch = search.create({
                type: search.Type.LOCATION,
                filters:
                [
                   ['internalid','is', locations[0]]
                ],
                columns:
                [
                    search.createColumn({
                        name: 'attention',
                        join: 'address'
                    }),
                    search.createColumn({
                        name: 'addressee',
                        join: 'address'
                    }),
                    search.createColumn({
                        name: 'address1',
                        join: 'address'
                    }),
                    search.createColumn({
                        name: 'address2',
                        join: 'address'
                    }),
                    search.createColumn({
                        name: 'city',
                        join: 'address'
                    }),
                    search.createColumn({
                        name: 'state',
                        join: 'address'
                    }),
                    search.createColumn({
                        name: 'zip',
                        join: 'address'
                    }),
                    search.createColumn({
                        name: 'countrycode',
                        join: 'address'
                    }),
                    search.createColumn({
                        name: 'phone',
                        join: 'address'
                    })
                ]
            }).run().getRange({ start: 0, end: 1 });
            if (locSearch.length < 1 ) {
                log.error({
                    title: 'LOCATION SEARCH ERROR',
                    details: 'Could not determine Ship From address from line items.'
                });
                return {};
            }
            fullAddr = {
                CompanyName: locSearch[0].getValue({ name: 'addressee', join: 'address' }),
                Address1: locSearch[0].getValue({ name: 'address1', join: 'address' }),
                Address2: locSearch[0].getValue({ name: 'address2', join: 'address' }),
                City: locSearch[0].getValue({ name: 'city', join: 'address' }),
                State: locSearch[0].getValue({ name: 'state', join: 'address' }),
                Country: locSearch[0].getValue({ name: 'countrycode', join: 'address' }),
                Zip: locSearch[0].getValue({ name: 'zip', join: 'address' }),
                Phone: locSearch[0].getValue({ name: 'phone', join: 'address' }),
                ExtendedAttributes: [
                    {
                        Name: 'addressee',
                        Value: locSearch[0].getValue({ name: 'addressee', join: 'address' })
                    },
                    {
                        Name: 'attention',
                        Value: locSearch[0].getValue({ name: 'attention', join: 'address' })
                    }
                ]
            };
            return fullAddr;
        }

        /**
         * Set Extended Attributes KVP data (in place)
         *
         * @param {Array} ext The Extended Attributes array
         * @param {string} name The name for the data
         * @param {string} value The value for the data
         */
         function setExtendedData(ext, name, value) {
             var updated = false;
             for (var i = 0; i < ext.length; i += 1) {
                 if (ext[i].Name === name) {
                     ext[i].Value = value;
                     updated = true;
                     break;
                 }
             }
             if (updated === false) {
                 ext.push({ Name: name, Value: value });
             }
         }

         /**
        * Get the LogicbrokerKey of a document that already exists in the Logicbroker system
        *
        * @param {string} result The response from trying to send the document
        * @returns {string} The Logicbroker Key
        */
        function getLogicbrokerKey(result) {
            try {
                var lk = result.indexOf('link key ');
                var space = result.indexOf(' ', lk + 9);
                var linkkey = result.substring(lk + 9, space);
                var url = helper.getApiUrl() + 'api/v1/shipments?filters.linkkey=' + linkkey;
                var apiRes = helper.getFromApi(url, ['Body', 'Shipments']).Result;
                if (apiRes.length > 0) {
                    return apiRes[0].LogicbrokerKey;
                }
            } catch (e) {
                helper.logError('Error getting original shipment Logicbroker key from API: ' + e.message);
            }
            return '0';
        }

        return {
            getInputData: getShipments,
            map: map,
            //reduce: reduce,
            summarize: summarize
        };
});