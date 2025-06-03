/**
 *@NApiVersion 2.0
 *@NScriptType UserEventScript
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
 * Company:     FMT Consultants LLC, www.fmtconsultants.com
 * Author:      smehmood@fmtconsultants.com
 * File:        WC_FMT_ItemReceiptLandedCost_UE.js
 * Date:        4/12/2021
 *
 ***********************************************************************/

define(['N/error', 'N/record', 'N/search', 'N/runtime'],
    function (error, record, search, runtime) {
        function afterSubmit(context) {
            log.debug("Aftersubmit Started.." + context.type, !!context.newRecord ?
                (context.newRecord.type + " " + context.newRecord.id) : "");

            if (context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT) {
                var itemReceiptId = context.newRecord.id;
                var itemReceiptRec = record.load({type: context.newRecord.type, id: itemReceiptId, isDynamic: true});
                var receiptDate = itemReceiptRec.getValue({fieldId: "trandate"});
                var isId = itemReceiptRec.getValue({fieldId: "inboundshipment"});
                var itemCostingData, lineCount, item, itemQty, itemCostData, lcSubRec, lcLineCount;
                var lclFoundIndex, commitLine = false;

                if (!!isId) {
                    itemCostingData = getISLandedCostItemwise(isId);
                    log.debug("itemCostingData", JSON.stringify(itemCostingData));

                    lineCount = itemReceiptRec.getLineCount({sublistId: "item"});
                    for (var i = 0; i < lineCount; i++) {
                        log.debug("Cost update process started for line : " + i);
                        itemReceiptRec.selectLine({sublistId: "item", line: i});
                        item = itemReceiptRec.getCurrentSublistValue({sublistId: "item", fieldId: "item", line: i});
                        itemQty = itemReceiptRec.getCurrentSublistValue({
                            sublistId: "item",
                            fieldId: "quantity",
                            line: i
                        });

                        try {
                            lcSubRec = itemReceiptRec.getCurrentSublistSubrecord({
                                sublistId: 'item',
                                fieldId: 'landedcost'
                            });
                            log.debug("Cost subrecord loaded for line : " + i);

                            itemCostData = itemCostingData[item];
                            if (!!itemCostData && itemCostData.length > 0) {
                                log.debug("itemCostData for line : " + i);
                                for (var j = 0; j < itemCostData.length; j++) {
                                    if (!!lcSubRec) {
                                        lcLineCount = lcSubRec.getLineCount({sublistId: "landedcostdata"});
                                        lclFoundIndex = lcSubRec.findSublistLineWithValue(
                                            {
                                                sublistId: "landedcostdata",
                                                fieldId: "costcategory",
                                                value: itemCostData[j].costCategroy
                                            });
                                        if (lclFoundIndex > -1) {
                                            lcSubRec.selectLine({sublistId: "landedcostdata", line: lclFoundIndex});
                                        } else {
                                            lcSubRec.selectNewLine({sublistId: "landedcostdata"});
                                            lcSubRec.setCurrentSublistValue({
                                                sublistId: "landedcostdata", fieldId: "costcategory",
                                                value: itemCostData[j].costCategroy
                                            });
                                        }

                                        lcSubRec.setCurrentSublistValue({
                                            sublistId: "landedcostdata", fieldId: "amount",
                                            value: itemCostData[j].unitRate * itemQty
                                        });
                                        lcSubRec.commitLine({sublistId: "landedcostdata"});
                                        commitLine = true;
                                    }
                                }
                            }
                        } catch (ex) {
                            log.debug("unable to add landed cost. line index : " + i);
                        }
                        if (commitLine)
                            itemReceiptRec.commitLine({sublistId: "item"});
                    }
                    if (commitLine) itemReceiptRec.save();
                }
            }
        }

        function isBlankOrNull(str) {
            if (str == null || str.toString() == "") return true; else return false;
        }

        function getISLandedCostItemwise(isId) {
            var ibsRec = record.load({type: 'inboundshipment', id: isId, isDynamic: true});
            var itemLinesCount = ibsRec.getLineCount({sublistId: "items"});
            var landedCostLinesCount = ibsRec.getLineCount({sublistId: "landedcost"});
            var itemLineIdsArray, landedCostAmount, totalQuantity = 0, lineQty, itemLineIndex;
            var itemCostCatKey, item, costCat, itemCostingData = {};

            for (var l = 0; l < landedCostLinesCount; l++) {
                itemCostCatKey = null;
                totalQuantity = 0;
                itemLineIdsArray = ibsRec.getSublistValue({
                    sublistId: "landedcost",
                    fieldId: "landedcostshipmentitems",
                    line: l
                });
                landedCostAmount = ibsRec.getSublistValue({
                    sublistId: "landedcost",
                    fieldId: "landedcostamount",
                    line: l
                });

                if (!!itemLineIdsArray) {
                    for (var a = 0; a < itemLineIdsArray.length; a++) {
                        itemLineIndex = ibsRec.findSublistLineWithValue({
                            sublistId: "items",
                            fieldId: "id",
                            value: itemLineIdsArray[a]
                        });
                        if (itemLineIndex > -1) {
                            lineQty = ibsRec.getSublistValue({
                                sublistId: "items",
                                fieldId: "quantityexpected",
                                line: itemLineIndex
                            });
                            lineQty = parseFloat(lineQty);
                            totalQuantity = totalQuantity + lineQty;
                            item = ibsRec.getSublistValue({
                                sublistId: "items",
                                fieldId: "itemid",
                                line: itemLineIndex
                            })
                        }
                    }

                    costCat = ibsRec.getSublistValue({
                        sublistId: "landedcost",
                        fieldId: "landedcostcostcategory",
                        line: l
                    });

                    if (!itemCostingData [item]) itemCostingData [item] = [];

                    itemCostingData [item].push({
                        costCategroy: costCat,
                        unitRate: landedCostAmount / totalQuantity
                    });
                }
            }
            return itemCostingData;
        }

        function getLocationIdByName(locName) {
            var output;
            var locationSearchObj = search.create({
                type: "location",
                filters: [
                    [
                        ["name", "is", locName]
                    ]
                ]
            });
            locationSearchObj.run().each(function (result) {
                output = result.id;
            });
            return output;
        }

        return {
            afterSubmit: afterSubmit
        };
    }
);


