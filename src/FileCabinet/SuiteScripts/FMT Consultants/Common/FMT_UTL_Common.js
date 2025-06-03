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
 * File:        FMT_CN_UTL_Common.js
 * Date:        3/4/2021
 *
 ***********************************************************************/

define(['N/search', 'N/record', 'N/runtime', 'N/task', 'N/format'],
    function (search, record, runtime, task, format) {
        return {
            searchAll: function (resultset) {
                var allResults = [];
                var startIndex = 0;
                var RANGECOUNT = 1000;
                do {
                    var pagedResults = resultset.getRange({
                        start: parseInt(startIndex),
                        end: parseInt(startIndex + RANGECOUNT)
                    });

                    allResults = allResults.concat(pagedResults);

                    var pagedResultsCount = pagedResults != null ? pagedResults.length : 0;
                    startIndex += pagedResultsCount;

                }
                while (pagedResultsCount == RANGECOUNT);
                return allResults;
            },
            //Get Formatted Date
            getFormattedDate: function (dateString) {
                var yr = dateString.substring(0, 2);
                var month = dateString.substring(2, 4);
                var day = dateString.substring(4, 6);
                var currentDate = new Date();
                var newDateString = month + "/" + day + "/" + ((currentDate.getFullYear()).toString()).substring(0, 2) + yr;
                var formattedDate = this.formatStringToDate(newDateString);
                return formattedDate;
            },
            //Format Date to String Field
            formatDateToString: function (input) {
                return (input.getMonth() + 1) + "/" + input.getDate() + "/" + input.getFullYear();
            },
            //Format String to Date Field(input)
            formatStringToDate: function (input) {
                return format.parse({
                    value: input,
                    type: format.Type.DATE
                });
            },
            addMonths: function (dt, months) {
                var newDate = new Date(dt);
                newDate.setMonth(newDate.getMonth() + months);
                return newDate;
            },
            addDays: function (dt, days) {
                var newDate = new Date(dt);
                newDate.setDate(newDate.getDate() + days);
                return newDate;
            },
            monthsDiff: function (d1, d2) {
                var months;
                months = (d2.getFullYear() - d1.getFullYear()) * 12;
                months -= d1.getMonth() + 1;
                months += d2.getMonth();
                // edit: increment months if d2 comes later in its month than d1 in its month
                if (d2.getDate() >= d1.getDate())
                    months++
                // end edit
                return months <= 0 ? 0 : months;
            },
            /**
             * Returns Serial Number Information for given internal id
             * @param {number} invNumId
             */
            getSerialNumberInfoById: function (invNumId) {
                var output;
                var customrecord_wrm_warrantyregSearchObj = search.create({
                    type: "inventorynumber",
                    filters: [['internalid', 'is', invNumId]],
                    columns: [
                        search.createColumn({
                            name: "inventorynumber",
                            label: "Number"
                        }),
                        search.createColumn({
                            name: "custitemnumber_cn_oem_serial",
                            label: "OEM Serial Number"
                        })
                    ]
                });
                customrecord_wrm_warrantyregSearchObj.run().each(function (result) {
                    output = {};
                    output.inventorynumber = result.getValue({name: "inventorynumber"});
                    output.custitemnumber_cn_oem_serial = result.getValue({name: "custitemnumber_cn_oem_serial"});
                });
                return output;
            },
            /**
             * Returns Serial Number Information for inventory number
             * @param {string} item
             * @param {string} invNum
             */
            getSerialNumberInfoByNumber: function (item, invNum) {
                var output;
                var customrecord_wrm_warrantyregSearchObj = search.create({
                    type: "inventorynumber",
                    filters: [['item', 'is', item], 'and', ['inventorynumber', 'is', invNum]],
                    columns: [
                        search.createColumn({
                            name: "custitemnumber_cn_oem_serial",
                            label: "OEM Serial Number"
                        })
                    ]
                });
                customrecord_wrm_warrantyregSearchObj.run().each(function (result) {
                    output = {};
                    output.inventorynumber = result.getValue({name: "inventorynumber"});
                    output.custitemnumber_cn_oem_serial = result.getValue({name: "custitemnumber_cn_oem_serial"});
                    output.id = result.id
                });
                return output;
            },
            isRescheduleNeeded: function (minUnits) {
                var MIN_UNITS = minUnits;
                var result = false;
                var remainingUsage = runtime.getCurrentScript().getRemainingUsage();

                log.debug({
                    title: 'units',
                    details: remainingUsage
                });

                if (remainingUsage < MIN_UNITS)
                    result = true;

                return result;
            },
            reschedule: function (params) {
                var scriptObj = runtime.getCurrentScript();

                log.debug('Script ID: ' + scriptObj.id);
                log.debug('Script Deployment ID: ' + scriptObj.deploymentId);

                var scriptTask = task.create({taskType: task.TaskType.SCHEDULED_SCRIPT});
                scriptTask.scriptId = scriptObj.id;
                scriptTask.deploymentId = scriptObj.deploymentId;
                //scriptTask.params = params;
                var scriptTaskId = scriptTask.submit();
            },
            findRevenueElementBySOLines: function (soId, lineUniqueKeys) {
                var records;
                var filters = [];
                var cols = [];
                var revenueElementIds = {};
                var lineUniqueKeysFilter = [];
                var revElemSearchObj;

                filters.push(['sourcetransaction.internalid', 'anyof', soId]);

                for (var u = 0; u < lineUniqueKeys.length; u++) {
                    lineUniqueKeysFilter.push(['sourcetransaction.lineuniquekey', 'equalto', lineUniqueKeys[u]]);
                    lineUniqueKeysFilter.push('or');
                }
                lineUniqueKeysFilter.pop();

                if (!!lineUniqueKeysFilter && lineUniqueKeysFilter.length > 0) {
                    filters.push('and');
                    filters.push(lineUniqueKeysFilter);
                }

                cols.push(search.createColumn({name: 'lineuniquekey', join: 'sourceTransaction'}));
                cols.push(search.createColumn({
                    name: "internalid",
                    join: "revenueArrangement",
                    label: "Internal ID"
                }));

                revElemSearchObj = search.create({
                    type: "revenueelement",
                });

                revElemSearchObj.filterExpression = filters;
                revElemSearchObj.columns = cols

                revElemSearchObj.run().each(function (result) {
                    revenueElementIds[result.getValue({name: 'lineuniquekey', join: 'sourceTransaction'})] = {};
                    revenueElementIds[result.getValue({
                        name: 'lineuniquekey',
                        join: 'sourceTransaction'
                    })].revenueelementid = result.id;
                    revenueElementIds[result.getValue({
                        name: 'lineuniquekey',
                        join: 'sourceTransaction'
                    })].revenuearrangementid =
                        result.getValue({
                            name: "internalid",
                            join: "revenueArrangement",
                            label: "Internal ID"
                        })
                });
                return revenueElementIds;
            },
            getKitMembers: function (kitItemIds) {
                var kitItemMembers = {};
                var kititemSearchObj = search.create({
                    type: "kititem",
                    filters:
                        [
                            ["type", "anyof", "Kit"],
                            "AND",
                            ["internalid", "anyof", kitItemIds]
                        ],
                    columns:
                        [
                            search.createColumn({name: "memberitem", label: "Member Item"}),
                            search.createColumn({name: "memberquantity", label: "Member Quantity"})
                        ]
                });

                var recs = this.searchAll(kititemSearchObj.run());

                for (var r = 0; r < recs.length; r++) {
                    if (!kitItemMembers[recs[r].id]) {
                        kitItemMembers[recs[r].id] = [];
                    }
                    kitItemMembers[recs[r].id].push({
                        memberItem: recs[r].getValue({name: "memberitem"}),
                        memberQuantity: recs[r].getValue({name: "memberquantity"}),
                    });
                }

                return kitItemMembers;
            }
        }
    });