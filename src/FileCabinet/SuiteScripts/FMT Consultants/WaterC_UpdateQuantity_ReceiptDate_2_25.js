/**
 *@NApiVersion 2.0
 *@NScriptType MapReduceScript
 *@NAmdConfig  /../config.json
 */

/***********************************************************************
 *
 * The following javascript code is created by FMT Consultants LLC,
 * a NetSuite Partner. It is a SuiteFlex component containing custom code
 * intended for NetSuite (www.netsuite.com) and use the SuiteScript API.
 * The code is provided "as is": FMT Consultants LLC shall not be liable
 * for any damages arising out the intended use or if the code is modified
 * after delivery.
 *
 *
 ***********************************************************************/

define(['N/search', 'N/record', 'N/query', 'N/runtime', 'N/error', 'N/format', 'underscore'],
    function (search, record, query, runtime, error, format, _) {


        function getInputData() {

            var itemSearchParam = runtime.getCurrentScript().getParameter('custscript_fmt_saved_search_items');
            var itemSearch = search.load({
                type: search.Type.ITEM,
                id: itemSearchParam
            });

            return itemSearch;
        }

        function map(context) { //3200 items
            var currentItem = JSON.parse(context.value);

            log.debug('This is my current Item', currentItem);

            var itemId = currentItem.id;
            var itemType = currentItem.values.type.value;

            var receiptDate = {};
            receiptDate['receiptQuantity'] = "";
            var quantityOnOrder = 20;
            var today = new Date();
            var recordType = "";

            var day = today.getDate();
            var month = today.getMonth() + 1;
            var year = today.getFullYear();

            var receipts = [];


            var dateToPass = month + "/" + day + "/" + year
            dateToPass = dateToPass.toString();
            log.debug('This is my Date to Pass for evaluation', dateToPass);

            if (itemType == 'InvtPart') {

                receipts = findMyReceipts(itemId, dateToPass);
                if (!!receipts && receipts.length > 0) {
                    receipts = _.sortBy(receipts, function (o) {
                        return o.receiptDate
                    });

                    receipts = receipts.reverse();
                }

                log.audit('These are the Receipts', receipts);

                if (!!receipts && receipts.length > 0) {

                    var receiptLength = receipts.length;
                    receiptDate = receipts[receiptLength - 1];
                    log.audit('This is new Receipt Date', receiptDate);
                    //  receiptDate = receipts[0];
                    recordType = receiptDate.type;
                    log.debug('This is my most Recent Receipt Date Object', receiptDate);
                    dateFound = receiptDate.receiptDate;
                    log.audit('This is my date Found', dateFound);

                }


                if (!!receiptDate.receiptQuantity) {
                    quantityOnOrder = receiptDate.receiptQuantity;
                }

                var newDate = calcDate(dateFound, today, recordType, itemType);

                newDate = checkforWeekend(newDate);

                context.write({
                    key: itemId, // item id
                    value: {
                        'receiptDate': newDate, //next reciept date
                        'quantityOnOrder': quantityOnOrder,
                        'type': itemType//quantity

                    }
                });


            } else {
                var kitComponents = [];
                var currentQuantity = 0;
                currentQuantity = checkforKitInventory(itemId);

                currentQuantity = currentQuantity.currentQuantity;
                log.audit('This is current Quantity of Kit in Object', currentQuantity);

                kitComponents = returnKitComponents(itemId, kitComponents);
                log.debug('Sam 2.0 Kit Components', kitComponents);

                if (kitComponents.length > 0) {
                    receipts = findMyKitReceipts_ItemRecord(kitComponents, dateToPass);

                    receipts = _.sortBy(receipts, function (o) {
                        return o.receiptDate;
                    });

                }


                log.debug('These are my Receipts passing Array', receipts);

                var dateFound;

                if (!!receipts && receipts.length > 0) {
                    var receiptLength = receipts.length;
                    receiptDate = receipts[0];
                    log.audit('New Receipt Date', receiptDate);
                    //  receiptDate = receipts[receipts.length];
                    recordType = receiptDate.type;
                    log.debug('This is my most Recent Receipt Date Object', receiptDate);
                    dateFound = receiptDate.receiptDate;
                    log.audit('This is my date Found', dateFound);
                }
                // if (!!receiptDate.receiptQuantity && receiptDate.receiptQuantity != '' && receiptDate.receiptQuantity > 0) {
                //     quantityOnOrder = receiptDate.receiptQuantity;
                // }
                newDate = dateFound;
                //var newDate = calcDate(dateFound, today, recordType, itemType);
                //log.debug('This is my Date to Set', newDate);
                //newDate = checkforWeekend(newDate);

                context.write({
                    key: itemId, // item id
                    value: {
                        'receiptDate': newDate, //next reciept date
                        'quantityOnOrder': null,
                        'availableQuantity': currentQuantity,
                        'type': itemType//quantity
                    }
                });
            }
        }


        function reduce(context) {

            var mapKeyData = context.key;
            log.debug('mapKeyData', mapKeyData);

            for (var j = 0; j < context.values.length; j++) {
                var mapValueData = JSON.parse(context.values[j]);
                log.audit('This is Map Value Data', mapValueData);

                if (mapValueData.type == 'InvtPart') {

                    log.audit('Final Submission Date Inv', new Date(mapValueData.receiptDate));
                    record.submitFields({
                        type: record.Type.INVENTORY_ITEM,
                        id: mapKeyData,
                        values: {
                            'custitem_fmt_next_receipt_date': new Date(mapValueData.receiptDate),
                            'custitem_fmt_next_receipt_quantity': mapValueData.quantityOnOrder
                        }
                    })
                } else {

                    log.audit('mapValueData.receiptDate', mapValueData.receiptDate);
                    var dateToSet;
                    if (!!mapValueData.receiptDate) {
                        dateToSet = new Date(mapValueData.receiptDate);
                    } else {
                        dateToSet = new Date();
                    }
                    log.debug('dateToSet', dateToSet);

                    record.submitFields({
                        type: record.Type.KIT_ITEM,
                        id: mapKeyData,
                        values: {
                            'custitem_fmt_next_receipt_date': dateToSet,
                            'custitem_fmt_avail_kit_quantity': mapValueData.availableQuantity
                        }
                    })

                }


            }

        }

        function summarize(context) {
            var inputSummary = context.inputSummary;
            var mapSummary = context.mapSummary;
            var reduceSummary = context.reduceSummary;

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

        function checkforKitInventory(invArr) {
            var searchResult = {};
            var quantity;

            log.debug('Checking for all Kit Inventory');

            var kititemSearchObj = search.create({
                type: "kititem",
                filters:
                    [
                        ["type", "anyof", "Kit"],
                        "AND",
                        ["memberitem.inventorylocation", "anyof", "1"],
                        "AND",
                        ["internalid", "anyof", invArr]
                    ],
                columns:
                    [
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

            log.debug('This is my search', kititemSearchObj);

            kititemSearchObj.run().each(function (result) {
                // .run().each has a limit of 4,000 results

                quantity = result.getValue({
                    name: "formulanumeric",
                    summary: "MIN",
                    formula: "NVL({memberitem.locationquantityavailable},0)/NVL({memberquantity},0)"
                });

                quantity = parseFloat(quantity);

                quantity = Math.floor(quantity);

                searchResult['currentQuantity'] = quantity;

                log.debug('This is object to return', searchResult);


                return true;
            });

            return searchResult;
        }

        //this used to find the expected receipt date

        function findMyReceipts(myItems, today) {
            var resArr = [];
            var resArr2 = [];
            var inbShipsFound = false;

            var inboundshipmentSearchObj = search.create({
                type: "inboundshipment",
                filters:
                    [
                        ["status", "anyof", ["inTransit", "toBeShipped"]],
                        "AND",
                        ["item", "anyof", myItems],
                        // "AND",
                        // ["expecteddeliverydate", "onorafter", "daysago0"]
                        "AND",
                        ["formulanumeric: case When {expecteddeliverydate} + 10 >= {today} THEN 1 ELSE 0 END", "equalto", "1"]
                    ],
                columns:
                    [
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
                // .run().each has a limit of 4,000 results
                var res2 = {};
                log.debug('These are my Search Results', result);

                var newReceiptDate = result.getValue({
                    name: "expecteddeliverydate",
                    summary: search.Summary.GROUP
                });

                if (!!newReceiptDate) {
                    log.debug('There is no empty Receipt date', newReceiptDate);

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
                    log.debug('THis is your res2 Ojbect', res2);

                    resArr.push(res2);

                }
                inbShipsFound = true;
                return true;

            });


            log.debug('Checking for POs now');
            //check for item attribute of PO stuff to have value

            //hey if my object exists or haas one line do nothign
            //if this is blank, then go ahead and run the Po search below
            if (!inbShipsFound) {
                var transactionSearchObj = search.create({
                    type: "transaction",
                    filters:
                        [
                            ["type", "anyof", "PurchOrd"],
                            "AND",
                            ["mainline", "is", "F"],
                            "AND",
                            ["shipping", "is", "F"],
                            "AND",
                            ["taxline", "is", "F"],
                            "AND",
                            ["item", "anyof", myItems],
                            //"AND",
                            //["expectedreceiptdate","onorafter","daysago0"]
                            "AND",
                            ["formulanumeric: case When {expectedreceiptdate} + 45 >= {today} THEN 1 ELSE 0 END", "equalto", "1"]
                        ],
                    columns:
                        [
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
                    // .run().each has a limit of 4,000 results
                    log.audit('These are my Search Results', result);

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

        function findMyKitReceipts(myItems, today) {

            log.debug('This is length of Items', myItems.length);
            var resArr = [];


            var inboundshipmentSearchObj = search.create({
                type: "inboundshipment",
                filters:
                    [
                        ["status", "anyof", "inTransit"],
                        "AND",
                        ["item", "anyof", myItems],
                        "AND",
                        ["expecteddeliverydate", "onorafter", "daysago0"]
                    ],
                columns:
                    [
                        search.createColumn({
                            name: "item",
                            summary: "MIN",
                            label: "Items - Item"
                        }),
                        search.createColumn({
                            name: "expecteddeliverydate",
                            summary: "MIN",
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
                // .run().each has a limit of 4,000 results
                var res2 = {};
                log.debug('These are my Search Results', result);


                var newReceiptDate = result.getValue({
                    name: "expecteddeliverydate",
                    summary: search.Summary.MIN
                });

                log.debug('This is for Shoaib!!!!!!', newReceiptDate);

                if (!!newReceiptDate) {
                    newReceiptDate = format.parse({
                        value: newReceiptDate,
                        type: format.Type.DATE
                    });

                    res2['receiptDate'] = newReceiptDate;


                    res2['receiptQuantity'] = result.getValue({
                        name: "quantityexpected",
                        summary: "SUM"
                    });


                    res2['type'] = "InboundShipment";
                    log.debug('THis is your res2 Ojbect', res2);
                    resArr.push(res2);

                }

                return true;

            });


            log.debug('This is my Date from Inbound', resArr);
            //check for item attribute of PO stuff to have value

            //hey if my object exists or haas one line do nothign
            //if this is blank, then go ahead and run the Po search below


            var transactionSearchObj = search.create({
                type: "purchaseorder",
                filters:
                    [
                        ["type", "anyof", "PurchOrd"],
                        "AND",
                        ["mainline", "is", "F"],
                        "AND",
                        ["taxline", "is", "F"],
                        "AND",
                        ["shipping", "is", "F"],
                        "AND",
                        ["item", "anyof", myItems],
                        "AND",
                        ["expectedreceiptdate", "onorafter", "daysago0"]

                    ],
                columns:
                    [
                        search.createColumn({
                            name: "item",
                            summary: "MIN",
                            label: "Item"
                        }),
                        search.createColumn({
                            name: "expectedreceiptdate",
                            summary: "MAX",
                            label: "Expected Receipt Date"
                        })
                    ]
            });

            transactionSearchObj.run().each(function (result) {
                var res = {};
                // .run().each has a limit of 4,000 results
                log.debug('These are my Search Results PO Search KIt ITems', result);

                var receiptDate2 = result.getValue({
                    name: "expectedreceiptdate",
                    summary: search.Summary.MAX
                });

                if (!!receiptDate2) {

                    receiptDate2 = format.parse({
                        value: receiptDate2,
                        type: format.Type.DATE
                    });


                    res['receiptDate'] = receiptDate2;


                    // res['receiptQuantity'] = result.getValue({
                    //     name: "formulanumeric",
                    // });

                    res['type'] = "PurchaseOrder";

                    resArr.push(res);

                }

                return true;

            });

            log.debug('This is my result Set', resArr);

            return resArr;
        }

        function findMyKitReceipts_ItemRecord(myItems, today) {

            log.debug('This is length of Items', myItems.length);
            var resArr = [];


            var itemSearchObj = search.create({
                type: "item",
                filters:
                    [
                        ['internalid', 'anyof', myItems]
                    ],
                columns:
                    [
                        search.createColumn({
                            name: "custitem_fmt_next_receipt_date", label: "Next Receipt Date",
                            summary: search.Summary.MAX
                        })
                    ]
            });

            itemSearchObj.run().each(function (result) {
                // .run().each has a limit of 4,000 results
                var res2 = {};
                log.debug('These are my Search Results', result);


                var newReceiptDate = result.getValue({
                    name: "custitem_fmt_next_receipt_date",
                    summary: search.Summary.MAX
                });

                log.debug('This is for Shoaib!!!!!!', newReceiptDate);

                if (!!newReceiptDate) {
                    newReceiptDate = format.parse({
                        value: newReceiptDate,
                        type: format.Type.DATE
                    });

                    res2['receiptDate'] = newReceiptDate;

                    log.debug('THis is your res2 Ojbect', res2);
                    resArr.push(res2);
                }
                return true;
            });

            log.debug('This is my result Set', resArr);
            return resArr;
        }

        //used to set the receipt date off of business logic
        function calcDate(receiptDate, trandate, type, recordType) {

            var myItemType = recordType;

            var dateToReturn;
            var tenDayDelay = parseInt(10);
            var thirtyDayDelay = parseInt(45);
            var ninetyDayDelay = parseInt(90);

            if (myItemType == "InvtPart") {

                if (!!receiptDate && receiptDate != '' && type == "InboundShipment") {
                    log.debug('Receipt Date has a value and is Inbound Shipment');

                    receiptDate = new Date(receiptDate);
                    receiptDate = receiptDate.setDate(receiptDate.getDate() + tenDayDelay);

                    dateToReturn = format.parse({
                        value: new Date(receiptDate),
                        type: format.Type.DATE
                    });

                    log.debug('This is my date to Return', dateToReturn);
                } else if (!!receiptDate && receiptDate != '' && type == "PurchaseOrder") {
                    log.debug('Receipt Date has a value and is PO', receiptDate);

                    receiptDate = new Date(receiptDate);
                    receiptDate = receiptDate.setDate(receiptDate.getDate() + thirtyDayDelay);

                    log.debug('Receipt Date after adding 30 days delay (Actually 45) ', receiptDate);

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
                    log.audit('Date to Return without formatting changes 7 21:', dateToReturn);
                }

                return dateToReturn;
            }
        }

        //to check for the date on the weekend

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
                log.debug('This date is not on a Weekend');

                dateToReturn = format.parse({
                    value: new Date(dateToReturn),
                    type: format.Type.DATE
                });

            }

            return dateToReturn;
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

        function returnKitComponents(itemid, itemArray) {
            log.debug('Attempting to return kit Components');
            log.debug('This is my empty Item with Array', itemid + "|printingEmptyArr" + itemArray);

            var kititemSearchObj = search.create({
                type: "kititem",
                filters:
                    [
                        ["type", "anyof", "Kit"],
                        "AND",
                        ["internalid", "anyof", itemid],
                        "And",
                        ["memberitem.inventorylocation", "anyof", "1"],
                        "AND",
                        ["formulanumeric: case when NVL({memberitem.locationquantityavailable},0)  = 0 then 0 when {memberitem.locationquantityavailable}<{memberquantity} then 0 end", "equalto", "0"]
                    ],
                columns:
                    [
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
                // .run().each has a limit of 4,000 results
                log.debug('Kit Component Search Result', result);

                itemArray.push(result.getValue({name: "internalid", join: 'memberItem'}));
                return true;
            });
            return itemArray;
        }

        return {
            //config:{
            //    retryCount: 3,
            //    exitOnError: true
            //},
            getInputData: getInputData,
            map: map,
            reduce: reduce,
            summarize: summarize
        };
    });