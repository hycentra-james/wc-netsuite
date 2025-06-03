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
 * File:        WC_FMT_InboundShipmentLandedCostUE.js
 * Date:        10/14/2020
 *
 ***********************************************************************/

define(['N/error', 'N/record', 'N/ui/serverWidget', 'N/search', 'N/file'],
    function (error, record, ui, search, file) {
        var DUTY_COST_CATEGORY_ID = '3';

        function beforeLoad(context) {
            var form = context.form;
            var tabs = form.getTabs();
            var catList, lineNo = 0, costAmountField, landedCostDataId, lcRec, sublistCount, currentLineCostCat,
                cLineIndex;
            var costCatAmount;
            var LANDED_COST_RELCALC_NOT_ALLOWED_STATUSES = ["received", "partiallyReceived"];

            //log.debug("tabs", JSON.stringify(tabs));

            if (context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT ||
                context.type == context.UserEventType.VIEW) {
                var sublist = form.addSublist({
                    id: "custpage_sublist",
                    type: ui.SublistType.LIST,
                    label: "Total Landed Costs",
                    tab: "landedcost_tab"
                });

                sublist.addField({
                    id: "custpage_costcategory",
                    type: ui.FieldType.SELECT,
                    label: "Cost Category",
                    source: "costcategory"
                });

                costAmountField = sublist.addField({
                    id: "custpage_costamount",
                    type: ui.FieldType.CURRENCY,
                    label: "Cost Amount"
                });

                if (context.type != context.UserEventType.VIEW) {
                    costAmountField.updateDisplayType({
                        displayType: ui.FieldDisplayType.ENTRY
                    });
                }

                catList = getCostCategoryList();

                if (!!catList) {
                    for (var key in catList) {
                        sublist.setSublistValue({
                            id: 'custpage_costcategory',
                            line: lineNo,
                            value: key
                        });
                        lineNo++;
                    }
                }

                if (context.type != context.UserEventType.CREATE) {
                    landedCostDataId = getLandedCostDataId(context.newRecord.id);
                    if (!!landedCostDataId) {
                        lcRec = record.load({type: "customrecord_landcostmaster", id: landedCostDataId});
                        sublistCount = sublist.lineCount;

                        for (var i = 0; i < sublistCount; i++) {
                            currentLineCostCat = sublist.getSublistValue({
                                id: 'custpage_costcategory',
                                line: i
                            });
                            cLineIndex = lcRec.findSublistLineWithValue({
                                sublistId: 'recmachcustrecord_fmt_ibshipment',
                                fieldId: 'custrecord_costcategory',
                                value: currentLineCostCat
                            });

                            if (cLineIndex > -1) {
                                costCatAmount = lcRec.getSublistValue({
                                    sublistId: "recmachcustrecord_fmt_ibshipment",
                                    fieldId: "custrecord_lcamount",
                                    line: cLineIndex
                                });

                                if (!isBlankOrNull(costCatAmount)) {
                                    sublist.setSublistValue({
                                        id: 'custpage_costamount',
                                        line: i,
                                        value: costCatAmount
                                    });
                                }
                            }
                        }
                    }

                }

                if (context.type == context.UserEventType.EDIT) {
                    var recalcLandedCostFld = form.getField({id: "custrecord_fmt_landedcostcalculated"});
                    var status = context.newRecord.getValue({fieldId: "shipmentstatus"});
                    if (LANDED_COST_RELCALC_NOT_ALLOWED_STATUSES.indexOf(status) > -1) {
                        recalcLandedCostFld.updateDisplayType({
                            displayType: ui.FieldDisplayType.DISABLED
                        });
                    }
                }
            }
        }

        function afterSubmit(context) {
            if (context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT) {
                var ibsRec = context.newRecord;
                var ibsUpdRec = record.load({type: context.newRecord.type, id: context.newRecord.id, isDynamic: true});
                var existingLandedCostRecId, lcRecLinesCount, itemsData;
                var landedCostCalcualted = ibsUpdRec.getValue({fieldId: "custrecord_fmt_landedcostcalculated"});
                var landedCostLinesCount = ibsUpdRec.getLineCount({sublistId: "landedcost"});

                if (!landedCostCalcualted) {
                    if (context.type == context.UserEventType.EDIT) {
                        for (var i = landedCostLinesCount - 1; i > -1; i--) {
                            ibsUpdRec.removeLine({sublistId: "landedcost", line: i});
                        }
                    }
                    //1- Save Landed Cost Data to Custom Record
                    log.debug("Save Landed Cost Data to Custom Record");
                    saveLandedCostData(ibsRec);
                    //2- Prepare data for Landed Cost Lines
                    log.debug("Prepare Landed Cost Lines Data");
                    itemsData = prepareLandedCostLinesData(ibsRec, ibsUpdRec);
                    log.debug("itemsData", JSON.stringify(itemsData));
                    var lineCount = ibsUpdRec.getLineCount({sublistId: "landedcost"});
                    log.audit("lineCount initial", lineCount);
                    if (!!itemsData && Object.keys(itemsData).length > 0) {
                        //3- Add/Update Duty Lines
                        log.debug("Add Landed Cost %based Calculation Lines");
                        addLandedCostPercentLines(ibsRec, ibsUpdRec, itemsData);
                        showLandedCostLines("Landed Cost lines after %based calculation in NS Object", ibsUpdRec);
                        //4- Add/Update Cost Category Lines
                        log.debug("Add Landed Cost Lines Category Wise");
                        addLandedCostLinesByCategory(ibsRec, ibsUpdRec, itemsData);
                        showLandedCostLines("Final landed cost lines in NS Object", ibsUpdRec);
                        ibsUpdRec.setValue({fieldId: "custrecord_fmt_landedcostcalculated", value: true});
                        //Removing Zero Amount Lines
                        try {
                            removeZeroLines(ibsUpdRec);
                        } catch (ex) {

                        }
                        //5- Finally Saving the Record
                        ibsUpdRec.save();
                    }
                }
            }
        }

        function showLandedCostLines(logTitle, rec) {
            var lineCount = rec.getLineCount({sublistId: "landedcost"});
            var lines = [];
            var line;
            for (var i = 0; i < lineCount; i++) {
                line = {};
                line.costcategory = rec.getSublistValue({
                    sublistId: "landedcost",
                    fieldId: "landedcostcostcategory",
                    line: i
                });
                line.landedcostamount = rec.getSublistValue({
                    sublistId: "landedcost",
                    fieldId: "landedcostamount",
                    line: i
                });
                if (line.landedcostamount <= 0)
                    lines.push(line);
            }
            log.debug(logTitle, JSON.stringify(lines));
        }

        function removeZeroLines(rec) {
            var lineCount = rec.getLineCount({sublistId: "landedcost"});
            var zeroLineIndex, moveNext;

            do {
                moveNext = false;
                zeroLineIndex = rec.findSublistLineWithValue({
                    sublistId: "landedcost",
                    fieldId: "landedcostamount",
                    value: 0
                });

                log.debug("zeroLineIndex", zeroLineIndex);
                if (zeroLineIndex > -1) {
                    rec.removeLine({sublistId: "landedcost", line: zeroLineIndex});
                    moveNext = true;
                }
            } while (moveNext);
        }

        // Add/Update Duty Lines
        function addLandedCostPercentLines(ibsRec, ibsUpdRec, itemsData) {
            var totalLCLines = ibsRec.getLineCount({sublistId: "custpage_sublist"});
            var pctValue, totalValue, calculatedDuty, itemLandedCostLines;
            if (!!itemsData) {
                for (var i in itemsData) {
                    itemLandedCostLines = itemsData[i].landedCosts;
                    if (!!itemLandedCostLines && itemLandedCostLines.length > 0) {
                        for (var l = 0; l < itemLandedCostLines.length; l++) {
                            pctValue = parseFloat(itemLandedCostLines[l].percentage);
                            pctValue = isNaN(pctValue) ? 0 : pctValue;
                            totalValue = itemsData[i].amount;
                            calculatedDuty = (pctValue / 100) * totalValue;

                            if (!!calculatedDuty) {
                                ibsUpdRec.selectNewLine({sublistId: "landedcost"});
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostcostcategory",
                                    value: itemLandedCostLines[l].costcategory
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostamount",
                                    value: calculatedDuty
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostcurrency",
                                    value: itemsData[i].landedcostcurrency
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostexchangerate",
                                    value: 1
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostallocationmethod",
                                    value: itemsData[i].allocationmethod
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostshipmentitems",
                                    value: itemsData[i].landedcostshipmentitems
                                });
                                ibsUpdRec.commitLine({
                                    sublistId: 'landedcost'
                                });
                            }
                        }
                    }
                }
            }
        }

        // Add/Update Landed Cost Lines by Cost Category
        function addLandedCostLinesByCategory(ibsRec, ibsUpdRec, itemsData) {
            var totalLCLines = ibsRec.getLineCount({sublistId: "custpage_sublist"});
            var cbmPct, totalValue, totalCCLandedCost, lcLinesCount, totalRecordedLCAmount, lastLine;
            var selectedLines = [], costCatagory;
            if (!!itemsData) {
                for (var c = 0; c < totalLCLines; c++) {
                    totalCCLandedCost = ibsRec.getSublistValue({
                        sublistId: "custpage_sublist",
                        fieldId: "custpage_costamount",
                        line: c
                    });

                    if (!!totalCCLandedCost) {
                        for (var i in itemsData) {
                            if (i == "16249") {
                                var z = 0;
                            }
                            //log.debug("i", i);
                            cbmPct = itemsData[i].cbmPct;
                            //log.debug("cbmPct", cbmPct);
                            totalCCLandedCost = parseFloat(totalCCLandedCost);
                            totalCCLandedCost = isNaN(totalCCLandedCost) ? 0 : totalCCLandedCost;
                            costCatagory = ibsRec.getSublistValue({
                                sublistId: "custpage_sublist",
                                fieldId: "custpage_costcategory",
                                line: c
                            });
                            if (costCatagory == "7") {
                                var y = 0;
                                log.debug("totalCCLandedCost * cbmPct", totalCCLandedCost * cbmPct);
                            }
                            if (!!cbmPct && !!totalCCLandedCost) {
                                ibsUpdRec.selectNewLine({sublistId: "landedcost"});
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostcostcategory",
                                    value: costCatagory
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostamount",
                                    value: totalCCLandedCost * cbmPct
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostcurrency",
                                    value: itemsData[i].landedcostcurrency
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostexchangerate",
                                    value: 1
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostallocationmethod",
                                    value: itemsData[i].allocationmethod
                                });
                                ibsUpdRec.setCurrentSublistValue({
                                    sublistId: "landedcost",
                                    fieldId: "landedcostshipmentitems",
                                    value: itemsData[i].landedcostshipmentitems
                                });
                                //log.debug("commit landed cost line");
                                ibsUpdRec.commitLine({
                                    sublistId: 'landedcost'
                                });
                            }

                            if (costCatagory == "7" || costCatagory == "9" || costCatagory == "3") {
                                selectedLines.push({
                                    item: i,
                                    cbmPct: cbmPct,
                                    totalCCLandedCost: totalCCLandedCost,
                                    costcategory: ibsRec.getSublistValue({
                                        sublistId: "custpage_sublist",
                                        fieldId: "custpage_costcategory",
                                        line: c
                                    })
                                });
                            }
                            log.debug("selectedLines", JSON.stringify(selectedLines));
                            showLandedCostLines("item : " + i + " category " + costCatagory, ibsUpdRec);
                        }
                    }
                }


                // Amount Adjustments
                // lcLinesCount = ibsUpdRec.getLineCount({sublistId: "landedcost"});
                // for (var c = 0; c < totalLCLines; c++) {
                //     totalRecordedLCAmount = 0;
                //     totalCCLandedCost = parseFloat(totalCCLandedCost);
                //     totalCCLandedCost = isNaN(totalCCLandedCost) ? 0 : totalCCLandedCost;
                //     lcLinesCount = ibsUpdRec.getLineCount({sublistId: "landedcost"});
                //     for (var k = 0; k < lcLinesCount; k++) {
                //         if (ibsRec.getSublistValue({
                //             sublistId: "custpage_sublist",
                //             fieldId: "custpage_costcategory",
                //             line: c
                //         }) == ibsUpdRec.getSublistValue({
                //             sublistId: "landedcost",
                //             fieldId: "landedcostcurrency",
                //             line: k
                //         })) {
                //             totalRecordedLCAmount = totalRecordedLCAmount + parseFloat(ibsUpdRec.getSublistValue({
                //                 sublistId: "landedcost",
                //                 fieldId: "landedcostamount",
                //                 line: k
                //             }));
                //             lastLine = k;
                //         }
                //     }
                //
                //     log.audit("totalCCLandedCost totalRecordedLCAmount", totalCCLandedCost + " " + totalRecordedLCAmount);
                //     if (totalCCLandedCost - totalRecordedLCAmount > 0) {
                //         ibsUpdRec.selectLine({sublistId: "landedcost", line: lastLine});
                //         ibsUpdRec.setCurrentSublistValue({
                //             sublistId: "landedcost",
                //             fieldId: "landedcostamount",
                //             value: totalCCLandedCost - totalRecordedLCAmount
                //         });
                //         ibsUpdRec.commitLine({
                //             sublistId: 'landedcost'
                //         });
                //     }
                // }
            }
        }

        //Prepare data for Landed Cost Lines
        function prepareLandedCostLinesData(ibsRec, ibsUpdRec) {
            var itemLinesCount = ibsUpdRec.getLineCount({sublistId: "items"});
            var itemWiseData = {}, currentLineItem = [], costCat, CostCatAmount;
            var itemLineQty, itemIds, itemProps, currentItemProps, itemLineAmount;
            var itemCbm, totalCbm = 0, itemQty;

            for (var i = 0; i < itemLinesCount; i++) {
                currentLineItem = ibsUpdRec.getSublistValue({sublistId: "items", fieldId: "itemid", line: i});
                if (!itemWiseData[currentLineItem]) {
                    itemWiseData[currentLineItem] = {};
                    itemWiseData[currentLineItem].landedcostshipmentitems = [];
                }
                itemLineQty = ibsUpdRec.getSublistValue({
                    sublistId: "items",
                    fieldId: "quantityexpected",
                    line: i
                });
                itemLineAmount = ibsUpdRec.getSublistValue({
                    sublistId: "items",
                    fieldId: "shipmentitemamount",
                    line: i
                });

                itemLineQty = parseFloat(itemLineQty);
                itemLineQty = isNaN(itemLineQty) ? 0 : itemLineQty;

                itemWiseData[currentLineItem].quantity = (!!itemWiseData[currentLineItem].quantity ? itemWiseData[currentLineItem].quantity : 0)
                    + itemLineQty;
                itemLineAmount = parseFloat(itemLineAmount);
                itemLineAmount = isNaN(itemLineAmount) ? 0 : itemLineAmount;

                itemWiseData[currentLineItem].amount = (!!itemWiseData[currentLineItem].amount ? itemWiseData[currentLineItem].amount : 0)
                    + itemLineAmount;
                itemWiseData[currentLineItem].landedcostcurrency = ibsUpdRec.getSublistValue({
                    sublistId: "items",
                    fieldId: "pocurrency",
                    line: i
                });
                itemWiseData[currentLineItem].allocationmethod = "QUANTITY";

                itemWiseData[currentLineItem].landedcostshipmentitems.push(ibsUpdRec.getSublistValue({
                    sublistId: "items",
                    fieldId: "id",
                    line: i
                }));
            }

            if (!!itemWiseData && Object.keys(itemWiseData).length > 0) {
                itemProps = getItemProperties(Object.keys(itemWiseData));
                for (var i in itemWiseData) {
                    currentItemProps = itemProps[i];
                    if (!!currentItemProps) {
                        for (var p in currentItemProps) {
                            itemWiseData[i][p] = currentItemProps[p];
                        }
                    }
                }

                for (var i in itemWiseData) {
                    itemCbm = itemWiseData[i].custitem_cbm;
                    itemCbm = parseFloat(itemCbm);
                    itemCbm = isNaN(itemCbm) ? 0 : itemCbm;
                    itemQty = itemWiseData[i].quantity;
                    totalCbm = totalCbm + (itemCbm * itemQty);
                }

                for (var i in itemWiseData) {
                    itemCbm = itemWiseData[i].custitem_cbm;
                    itemCbm = parseFloat(itemCbm);
                    itemCbm = (isNaN(itemCbm) ? 0 : itemCbm) * itemWiseData[i].quantity;
                    itemWiseData[i].cbmPct = (itemCbm / totalCbm);
                }
            }
            return itemWiseData;
        }

        function getItemProperties(itemIds) {
            var itemProps = {};
            var srch = search.create({
                type: "item",
                filters: ['internalid', 'anyof', itemIds],
                columns: [search.createColumn('custitem_cbm')]
            });

            srch.run().each(function (result) {
                itemProps[result.id] = {};
                itemProps[result.id]['custitem_cbm'] = result.getValue({name: "custitem_cbm"});

                return true;
            });

            srch = search.create({
                type: "customrecord_fmt_itmlandedcostsetup",
                filters: [
                    ["custrecord_fmt_item", "anyof", itemIds]
                ],
                columns: [
                    search.createColumn({name: "custrecord_fmt_costcategory", label: "Cost Category"}),
                    search.createColumn({name: "custrecord_fmt_lcpct", label: "Percentage"}),
                    search.createColumn({name: "custrecord_fmt_item", label: "Item"}),
                    search.createColumn({
                        name: "custrecord_fmt_ccwcostcategory",
                        join: "CUSTRECORD_FMT_COSTCATEGORY",
                        label: "Cost Category"
                    }),
                    search.createColumn({
                        name: "custitem_cbm",
                        join: "CUSTRECORD_FMT_ITEM",
                        label: "CBM"
                    })
                ]
            });


            srch.run().each(function (result) {
                if (!itemProps[result.getValue('custrecord_fmt_item')]) {
                    itemProps[result.getValue('custrecord_fmt_item')] = {};
                }

                if (!itemProps[result.getValue('custrecord_fmt_item')].landedCosts) {
                    itemProps[result.getValue('custrecord_fmt_item')].landedCosts = [];
                }


                itemProps[result.getValue('custrecord_fmt_item')].landedCosts.push({
                    costcategory: result.getValue({
                        name: 'custrecord_fmt_ccwcostcategory',
                        join: 'CUSTRECORD_FMT_COSTCATEGORY'
                    }),
                    percentage: result.getValue('custrecord_fmt_lcpct')
                });
                itemProps[result.getValue('custrecord_fmt_item')].custitem_cbm = result.getValue({
                    name: 'custitem_cbm',
                    join: 'CUSTRECORD_FMT_ITEM'
                });
                return true;
            });
            return itemProps;
        }

        //Function to save Landed Cost Data from Temporary UI to Custom Reccord
        function saveLandedCostData(ibsRec) {
            var totalLCLines = ibsRec.getLineCount({sublistId: "custpage_sublist"});
            var lcRec, existingLandedCostRecId, lcRecLinesCount

            log.debug("Total Landed Cost Lines : " + totalLCLines, "   InBound Shipment Id : " + ibsRec.id);

            if (!!totalLCLines) {
                existingLandedCostRecId = getLandedCostDataId(ibsRec.id);

                if (!!existingLandedCostRecId) {
                    log.debug("Loading the customrecord_landcostmaster record", existingLandedCostRecId);
                    lcRec = record.load({
                        type: "customrecord_landcostmaster",
                        isDynamic: true,
                        id: existingLandedCostRecId
                    });
                    lcRecLinesCount = lcRec.getLineCount({sublistId: "recmachcustrecord_fmt_ibshipment"});

                    if (!!lcRecLinesCount) {
                        for (var i = lcRecLinesCount - 1; i > -1; i--) {
                            lcRec.removeLine({sublistId: "recmachcustrecord_fmt_ibshipment", line: i});
                        }
                    }
                } else {
                    log.debug("Creating the customrecord_landcostmaster record", existingLandedCostRecId);
                    lcRec = record.create({type: "customrecord_landcostmaster", isDynamic: true});
                    lcRec.setValue({fieldId: "custrecord_fmt_ibs", value: ibsRec.id});
                }

                for (var i = 0; i < totalLCLines; i++) {
                    lcRec.selectNewLine({sublistId: "recmachcustrecord_fmt_ibshipment"});
                    lcRec.setCurrentSublistValue({
                        sublistId: "recmachcustrecord_fmt_ibshipment",
                        fieldId: "custrecord_costcategory",
                        value: ibsRec.getSublistValue({
                            sublistId: "custpage_sublist",
                            fieldId: "custpage_costcategory",
                            line: i
                        })
                    });
                    lcRec.setCurrentSublistValue({
                        sublistId: "recmachcustrecord_fmt_ibshipment",
                        fieldId: "custrecord_lcamount",
                        value: ibsRec.getSublistValue({
                            sublistId: "custpage_sublist",
                            fieldId: "custpage_costamount",
                            line: i
                        })
                    });
                    lcRec.commitLine({sublistId: "recmachcustrecord_fmt_ibshipment"});
                }
                log.debug("Saving the customrecord_landcostmaster record");
                if (!!lcRec) lcRec.save();
            }
        }

        //Get Cost Category List except Duty
        function getCostCategoryList() {
            var costCategoryList = {};
            //var costcategorySearchObj = search.create({
            //    type: "costcategory",
            //    filters: [
            //        ["itemcosttype", "anyof", "LANDED"],
            //        "AND",
            //        ["name", "isnot", "Duty"]
            //    ],
            //    columns: [
            //        search.createColumn({
            //            name: "name",
            //            sort: search.Sort.ASC,
            //            label: "Name"
            //        })
            //    ]
            //});
            //var searchResultCount = costcategorySearchObj.runPaged().count;
            //costcategorySearchObj.run().each(function (result) {
            //
            //    costCategoryList[result.id] = result.getValue({name: "name"});
            //    return true;
            //});

            var customrecord_fmt_costcategorywrapperSearchObj = search.create({
                type: "customrecord_fmt_costcategorywrapper",
                filters: [
                    ["custrecord_itemvaluebasedcalculation", "is", "F"]
                ],
                columns: [
                    search.createColumn({name: "custrecord_fmt_ccwcostcategory", label: "Cost Category"})
                ]
            });
            var searchResultCount = customrecord_fmt_costcategorywrapperSearchObj.runPaged().count;
            //log.debug("customrecord_fmt_costcategorywrapperSearchObj result count", searchResultCount);
            customrecord_fmt_costcategorywrapperSearchObj.run().each(function (result) {
                costCategoryList[result.getValue({name: "custrecord_fmt_ccwcostcategory"})] = result.getText({name: "custrecord_fmt_ccwcostcategory"});
                return true;
            });


            return costCategoryList;
        }

        //Get Stored LandedCost data by InboundShipment Id
        function getLandedCostDataId(isId) {
            var lcdId;
            var customrecord_landcostmasterSearchObj = search.create({
                type: "customrecord_landcostmaster",
                filters: [
                    ["custrecord_fmt_ibs", "is", isId]
                ]
            });

            var searchResultCount = customrecord_landcostmasterSearchObj.runPaged().count;
            //log.debug("customrecord_landcostmasterSearchObj result count", searchResultCount);
            customrecord_landcostmasterSearchObj.run().each(function (result) {
                lcdId = result.id;
            });
            return lcdId;
        }

        function isBlankOrNull(str) {
            if (str == null || str.toString() == "") return true; else return false;
        }

        return {
            beforeLoad: beforeLoad,
            afterSubmit: afterSubmit
        };
    });



