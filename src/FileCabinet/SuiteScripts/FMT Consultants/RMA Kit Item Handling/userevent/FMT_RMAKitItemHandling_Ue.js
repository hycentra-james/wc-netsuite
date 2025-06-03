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
 * File:        FMT_RMAKitItemHandling_Ue.js
 * Date:        8/16/2021
 *
 ***********************************************************************/
define(['N/search', 'N/record', 'N/error', 'N/runtime', '../../Common/FMT_UTL_Common'],
    function (search, record, error, runtime, fmtCommonUtil) {

        function afterSubmit(context) {
            if (context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT) {
                try {
                    var recId = context.newRecord.id;
                    var createdFrom = context.newRecord.getValue({fieldId: "createdfrom"});
                    if (!!createdFrom) {
                        var nsRec = record.load({type: context.newRecord.type, id: recId, isDynamic: true});
                        var cfType, kitItems = [], lineItemType, isClosed, kitWiseMembers, openKitItemIndex,
                            oneKitMembers;
                        var lineItem, lineItemQty, lineItemDesc, lineItemName, lineItemQty;
                        cfType = search.lookupFields({type: "invoice", id: createdFrom, columns: ["type"]});
                        log.debug("cfType", JSON.stringify(cfType));

                        if (!!cfType && !!cfType.type && cfType.type[0] && cfType.type[0].value == "CustInvc") {
                            var lineCount = nsRec.getLineCount({sublistId: "item"});
                            for (var i = 0; i < lineCount; i++) {
                                lineItem = nsRec.getSublistValue({sublistId: 'item', fieldId: 'item', line: i});
                                lineItemType = nsRec.getSublistValue({sublistId: 'item', fieldId: 'itemtype', line: i});
                                isClosed = nsRec.getSublistValue({
                                    sublistId: "item",
                                    fieldId: "isclosed",
                                    line: i
                                });
                                if (isClosed) continue;

                                if (lineItemType == "Kit") {
                                    kitItems.push(lineItem);
                                }
                                if (kitItems.length > 0) {
                                    kitWiseMembers = fmtCommonUtil.getKitMembers(kitItems);
                                    {
                                        openKitItemIndex = findOpenKitItem(nsRec);
                                        while (openKitItemIndex > -1) {
                                            lineItem = nsRec.getSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'item',
                                                line: openKitItemIndex
                                            });
                                            lineItemQty = nsRec.getSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'quantity',
                                                line: openKitItemIndex
                                            });
                                            lineItemDesc = nsRec.getSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'description',
                                                line: openKitItemIndex
                                            });
                                            lineItemName = nsRec.getSublistText({
                                                sublistId: 'item',
                                                fieldId: 'item',
                                                line: openKitItemIndex
                                            });
                                            oneKitMembers = kitWiseMembers[lineItem];
                                            nsRec.selectLine({sublistId: 'item', line: openKitItemIndex});
                                            nsRec.setCurrentSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'isclosed',
                                                value: true
                                            });
                                            nsRec.commitLine({sublistId: 'item'});

                                            for (var k = 0; k < oneKitMembers.length; k++) {
                                                nsRec.insertLine({
                                                    sublistId: 'item',
                                                    line: openKitItemIndex + k + 1,
                                                });
                                                nsRec.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'item',
                                                    value: oneKitMembers[k].memberItem
                                                });
                                                nsRec.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'quantity',
                                                    value: oneKitMembers[k].memberQuantity * lineItemQty
                                                });
                                                nsRec.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'rate',
                                                    value: 0
                                                });
                                                nsRec.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'amount',
                                                    value: 0
                                                });
                                                //Kit Item Info to Member Line
                                                nsRec.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'custcol_fmt_kititem',
                                                    value: lineItemName
                                                });
                                                nsRec.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'custcol_fmt_kititemdesc',
                                                    value: lineItemDesc
                                                });
                                                nsRec.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'custcol_fmt_kititemid',
                                                    value: lineItem
                                                });
                                                nsRec.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'custcol_fmt_quantity',
                                                    value: lineItemQty
                                                });

                                                nsRec.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'custcol_fmt_donotprint',
                                                    value: true
                                                });
                                                nsRec.commitLine({
                                                    sublistId: 'item'
                                                });
                                            }
                                            openKitItemIndex = findOpenKitItem(nsRec);
                                        }
                                    }
                                }
                            }
                            nsRec.setValue({        // Resetting kit item handling error
                                fieldId: "custbody_fmt_kititemhandlingcomnts",
                                value: ''
                            });
                            nsRec.save();
                        } else {
                            log.debug('This RMA NOT generated from any invoice.');
                        }
                    } else {
                        log.debug('This RMA NOT generated from any record.');
                    }
                } catch (ex) {
                    log.error('error when handling kit items', 'error when expanding Kit Items' + ex.toString());
                    if (!!nsRec) {
                        nsRec.setValue({
                            fieldId: "custbody_fmt_kititemhandlingcomnts",
                            value: 'error when expanding Kit Items ' + ex.message
                        });
                        nsRec.save();
                    }
                }
            }
        }

        function findOpenKitItem(nsRec) {
            var lineCount = nsRec.getLineCount({sublistId: "item"});
            var lineItemType, isClosed, foundIndex = -1;
            for (var i = 0; i < lineCount; i++) {
                lineItemType = nsRec.getSublistValue({sublistId: 'item', fieldId: 'itemtype', line: i});
                isClosed = nsRec.getSublistValue({
                    sublistId: "item",
                    fieldId: "isclosed",
                    line: i
                });

                if (isClosed) continue;

                if (lineItemType == "Kit") {
                    foundIndex = i;
                    break;
                }
            }

            return foundIndex;
        }

        return {
            afterSubmit: afterSubmit
        };
    }
);





