/**
*@NApiVersion 2.x
*@NScriptType MapReduceScript
*/

define (['N/runtime', 'N/record', 'N/search', './suppHelper'],
    function (runtime, record, search, helper) {
        /**
         * Find all invoices ready to be exported to Logicbroker
         *
         * @returns {array} The internal IDs of all invoices to be exported
         */
        function findInvoices() {
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
            var filters = [
                ['type','is','CustInvc'],
                'AND',
                ['custbody_lb_orderlbkey','isnotempty', ''],
                'AND',
                ['custbodylb_exportstatus','is','3'],
                'AND',
                ['mainline','is','T'],
            ];
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
            context.write('id', id);
            try {
                var invoice = record.load({
                    type: record.Type.INVOICE,
                    id: id,
                    isDynamic: true
                });
            } catch (e) {
                log.error({
                    title: 'LOADING ERROR',
                    details: 'Could not load Invoice ' + id + ': ' + e.message
                });
                return;
            }
            var tranId = invoice.getValue({ fieldId: 'tranid' });
            var orderLbKey = invoice.getValue({ fieldId: 'custbody_lb_orderlbkey' });
            var soId = invoice.getValue({ fieldId: 'createdfrom' });
            if (!soId) {
                var soidError = 'Invoice ' + tranId + ' was not created off of a sales order in NetSuite and therefore cannot be exported';
                log.error({
                    title: 'NO ASSOCIATED SO',
                    details: soidError
                });
                helper.createFailedExportEvent(apiUrl, 'invoice', tranId, null, orderLbKey, soidError);
                invoice.setValue({
                    fieldId: 'custbodylb_exportstatus',
                    value: 2
                });
                invoice.setValue({
                    fieldId: 'custbody_lb_errormsg',
                    value: soidError
                });
                try {
                    invoice.save();
                } catch (e) {
                    msg = 'Error saving invoice ' + tranId + ' in NetSuite: ' + e.message;
                    log.error({
                        title: 'SAVE ERROR',
                        details: msg
                    });
                }
                return;
            }
            var soFields = search.lookupFields({
                    type: search.Type.SALES_ORDER,
                    id: soId,
                    columns: ['tranid', 'otherrefnum']
                });

            var lbInv = {
                InvoiceNumber: tranId,
                InvoiceDate: invoice.getValue({ fieldId: 'trandate' }),
                HandlingAmount: invoice.getValue({ fieldId: 'handlingcost' }),
                Note: invoice.getText({ fieldId: 'memo' }),
                InvoiceTotal: invoice.getValue({ fieldId: 'total' }),
                InvoiceLines: getInvoiceLines(invoice),
                OrderNumber: soFields.tranid,
                PartnerPO: soFields.otherrefnum,
                ShipToAddress: getAddress(invoice, 'ship'),
                BillToAddress: getAddress(invoice, 'bill'),
                ShipFromAddress: getShipFrom(invoice),
                ExtendedAttributes: [],
                Discounts: [],
                ShipmentInfos: []
            };

            // Taxes
            if (invoice.getValue({ fieldId: 'taxtotal' })) {
                lbInv.Taxes = [{
                    TaxAmount: invoice.getValue({ fieldId: 'taxtotal' }),
                    TaxTitle: 'Total Tax'
                }];
            }

            // Payment Term
            var dueDate = invoice.getValue({ fieldId: 'duedate' });
            var discountdate = invoice.getValue({ fieldId: 'discountdate' })
            lbInv.PaymentTerm = {
                TermsDescription: invoice.getText({ fieldId: 'terms' }) || '',
            };
            if(dueDate){
                lbInv.PaymentTerm.DueDate = dueDate;
            }
            if(discountdate){
                lbInv.PaymentTerm.DiscountDueDate = discountdate;
            }

            // Discount
            lbInv.Discounts.push({
                DiscountAmount: 0 - invoice.getValue({ fieldId: 'discounttotal' })
            });

            // Packages
            var createdfrom = invoice.getValue({ fieldId: 'createdfrom' });
            var pkgInfos = getPackageInfo(createdfrom);
            lbInv.ShipmentInfos = pkgInfos;

            // Set Header KVPs
            setExtendedData(lbInv.ExtendedAttributes, 'ShippingCost', invoice.getValue({ fieldId: 'shippingcost' }));
            setExtendedData(lbInv.ExtendedAttributes, 'AltHandlingCost', invoice.getValue({ fieldId: 'althandlingcost' }));
            setExtendedData(lbInv.ExtendedAttributes, 'AltShippingCost', invoice.getValue({ fieldId: 'altshippingcost' }));
            setExtendedData(lbInv.ExtendedAttributes, 'CustomerMessage', invoice.getValue({ fieldId: 'message' }));
            setExtendedData(lbInv.ExtendedAttributes, 'Status', invoice.getValue({ fieldId: 'status' }));
            setExtendedData(lbInv.ExtendedAttributes, 'internalOrderId', soId);
            setExtendedData(lbInv.ExtendedAttributes, 'internalInvoiceId', id);

            // Add on all custom fields as Extended Attributes
            var custFields = helper.getCustBodyFields(invoice);
            custFields.forEach(function (fieldName) {
                var fieldVal = invoice.getValue({ fieldId: fieldName });
                if (fieldVal !== null && fieldVal !== '') {
                    if(typeof fieldVal == 'object') {
                        fieldVal = JSON.stringify(fieldVal);
                    }
                    setExtendedData(lbInv.ExtendedAttributes, fieldName, fieldVal);
                }
            });

            // Post to Logicbroker
            var apiUrl = helper.getApiUrl();
            var url = apiUrl + 'api/v1/Invoices';
            try {
                var ret = helper.postToApi(url, JSON.stringify(lbInv), ['Body']);
                if (ret.Result.hasOwnProperty('LogicbrokerKey')) {
                    invoice.setValue({
                        fieldId: 'custbody_lb_invoicelbkey',
                        value: ret.Result.LogicbrokerKey
                    });
                }
                invoice.setValue({
                    fieldId: 'custbodylb_exportstatus',
                    value: 1
                });
                log.debug({
                    title: 'INVOICE EXPORTED',
                    details: 'Invoice ' + tranId + ' was successfully exported to Logicbroker.'
                });
                invoice.save();
            } catch (e) {
                var msg;
                var changedMatch = 'Record has been changed';
                var hostMatch = 'The host you are trying to connect to is not responding';
                var noShipMatch = 'The following lines cannot be invoiced because they are not shipped';
                if (e.message.indexOf(changedMatch) !== -1) {
                    msg = 'Error saving invoice ' + tranId + ' in NetSuite: ' + e.message;
                    log.error({
                        title: 'SAVE ERROR',
                        details: msg
                    });
                } else if (e.message.indexOf(hostMatch) !== -1) {
                    msg = 'Error sending invoice ' + tranId + ' to Logicbroker: ' + e.message;
                    log.error({
                        title: 'EXPORT ERROR',
                        details: msg
                    });
                    invoice.setValue({
                        fieldId: 'custbody_lb_errormsg',
                        value: msg
                    });
                    try {
                        invoice.save();
                    } catch (err) {
                        msg = 'Error saving invoice ' + tranId + ' in NetSuite: ' + err.message;
                        log.error({
                            title: 'SAVE ERROR',
                            details: msg
                        });
                    }
                } else if (e.message.indexOf(noShipMatch) !== -1) {
                    msg = 'Error exporting invoice ' + tranId + ' to Logicbroker: Lines on this invoice have not yet been shipped in Logicbroker. '
                        + 'This invoice will attempt to export again on the next script execution and has not been marked as Failed.';
                    log.error({
                        title: 'EXPORT ERROR',
                        details: msg
                    });
                    helper.createFailedExportEvent(apiUrl, 'invoice', tranId, lbInv, orderLbKey, msg);
                    invoice.setValue({
                        fieldId: 'custbody_lb_errormsg',
                        value: msg
                    });
                    try {
                        invoice.save();
                    } catch (err) {
                        msg = 'Error saving invoice ' + tranId + ' in NetSuite: ' + err.message;
                        log.error({
                            title: 'SAVE ERROR',
                            details: msg
                        });
                    }
                } else {
                    msg = 'Error exporting invoice ' + tranId + ' to Logicbroker: ' + e.message;
                    log.error({
                        title: 'EXPORT ERROR',
                        details: msg
                    });
                    helper.createFailedExportEvent(apiUrl, 'invoice', tranId, lbInv, orderLbKey, msg);
                    invoice.setValue({
                        fieldId: 'custbodylb_exportstatus',
                        value: 2
                    });
                    invoice.setValue({
                        fieldId: 'custbody_lb_errormsg',
                        value: msg
                    });
                    try {
                        invoice.save();
                    } catch (err) {
                        msg = 'Error saving invoice ' + tranId + ' in NetSuite: ' + err.message;
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
                " Number of yields: " + context.yields + " Total invoices processed: " + totalItemsProcessed;
            log.audit({ title: 'Summary of usage', details: summaryMessage });
        }

        /**
         * Create the InvoiceLines from an item fulfillment record
         *
         * @param {Invoice} invoice The Invoice record
         * @returns {array} The array of InvoiceLines
         */
        function getInvoiceLines(invoice) {
            var invoiceLines = [];
            var lineCount = invoice.getLineCount({ sublistId: 'item' });

            var itemTypes = {
                InvtPart: record.Type.INVENTORY_ITEM,
                NonInvtPart: record.Type.NON_INVENTORY_ITEM,
                Assembly: record.Type.ASSEMBLY_ITEM,
                Kit: record.Type.KIT_ITEM
            };

            for (var i = 0; i < lineCount; i++) {
            	invoice.selectLine({ sublistId: 'item', line: i });
                var description = invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: 'description' });
                var qty = invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' });
                var itemId = invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' });
                var price = invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: 'rate' });
                var cost = invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: 'cost' });
                var itemType = invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemtype' });
                var sku = invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_lbret_itemid' });
                var lineNum = invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_lb_linenum' })
                    || invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: 'orderline' });
                var invoiceLine = {
                    ItemIdentifier: {
                        SupplierSKU: sku
                    },
                    LineNumber: lineNum,
                    Description: description || '',
                    Quantity: qty,
                    QuantityUOM: 'EA',
                    Price: price,
                    Cost: cost || 0,
                    ExtendedAttributes: []
                };
                if (itemTypes[itemType]) {
                    var itemFields = search.lookupFields({
                        type: itemTypes[itemType],
                        id: itemId,
                        columns: ['upccode']
                    });
                    invoiceLine.ItemIdentifier.UPC = itemFields.upccode;
                }
                setExtendedData(invoiceLine.ExtendedAttributes, 'itemType', itemType);

                // Add on all custom line-level fields as Extended Attributes
                var custFields = helper.getCustLineFields(invoice);
                custFields.forEach(function (fieldName) {
                	var fieldVal = invoice.getCurrentSublistValue({ sublistId: 'item', fieldId: fieldName });
                	if (fieldVal !== null && fieldVal !== '') {
                		if(typeof fieldVal == 'object') {
                			fieldVal = JSON.stringify(fieldVal);
                		}
                		setExtendedData(invoiceLine.ExtendedAttributes, fieldName, fieldVal);
                	}
                });

                invoiceLines.push(invoiceLine);
            }
            return invoiceLines;
        }

        /**
         * Get shipping or billing address as JSON
         *
         * @param {Transaction} rec The record to get the address from
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
         * @param {Record} rec The invoice record
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
         * Get all package infos from any Item Fulfillments linked to the Sales Order
         *
         * @param {string} soId The internal ID of the Sales Order associated with the invoice
         * @returns {Array} The package infos
         */
        function getPackageInfo(soId) {
            if (!soId) {
                return [];
            }
            var pkgInfos = [];
            var pkgSearch = search.create({
                type: 'itemfulfillment',
                filters:
                [
                   ['type','anyof','ItemShip'],
                   'AND',
                   ['shipmentpackage.trackingnumber','isnotempty',''],
                   'AND',
                   ['mainline','is','T'],
                   'AND',
                   ['createdfrom','anyof', soId]
                ],
                columns:
                [
                   search.createColumn({
                      name: 'trackingnumber',
                      join: 'shipmentPackage'
                   }),
                   search.createColumn({ name: 'shipmethod' }),
                   search.createColumn({
                      name: 'weightinlbs',
                      join: 'shipmentPackage'
                   })
                ]
             });
             pkgSearch.run().each(function (res) {
                var trackNum = res.getValue({ name: 'trackingnumber', join: 'shipmentPackage' });
                var shipMethod = res.getText({ name: 'shipmethod' });
                shipMethod = shipMethod.replace(/[^a-zA-Z0-9 ]/g, '');
                var weight = res.getValue({ name: 'weightinlbs', join: 'shipmentPackage' });
                pkgInfos.push({
                    TrackingNumber: trackNum,
                    ClassCode: shipMethod,
                    Weight: weight
                });
                return true;
            });
            return pkgInfos;
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

        return {
            getInputData: findInvoices,
            map: map,
            //reduce: reduce,
            summarize: summarize
        };
});