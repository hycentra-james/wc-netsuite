/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/log', 'N/email', 'N/render', 'N/format', './maerskHelper', '../../moment.min.js'],
    function (record, search, log, email, render, format, helper, moment) {
        function beforeSubmit(context) {
            var currentRecord = context.type === context.UserEventType.CREATE ? context.newRecord : context.oldRecord;

            // Check if the Item Fulfillment is from Home Depot (317) and is using Pilot Freight Service (id=3788) shipmethod
            if (currentRecord.getValue({ fieldId: 'entity' }) == 317 && currentRecord.getValue({ fieldId: 'shipmethod' }) == 3788) {
                log.debug('Start', '----------------------------------------------------');
                log.debug('DEBUG', 'beforeSubmit()');
                log.debug('DEBUG', 'context.type = ' + context.type);
                log.debug('DEBUG', 'currentRecord.createdfrom = ' + currentRecord.getValue({ fieldId: 'createdfrom' }));
                log.debug('DEBUG', 'currentRecord.entity = ' + currentRecord.getValue({ fieldId: 'entity' }));
                log.debug('DEBUG', 'currentRecord.shipmethod = ' + currentRecord.getValue({ fieldId: 'shipmethod' }));
                try {
                    if (context.type === context.UserEventType.CREATE) {
                        log.debug('DEBUG', 'currentRecord.shipmethod = ' + currentRecord.getValue({ fieldId: 'shipmethod' }));
                        log.debug('DEBUG', 'currentRecord.entity = ' + currentRecord.getValue({ fieldId: 'entity' }));
                        var dataPayload = getDataPayload(context);
                        // Prepare the API call information
                        postToCreateApi(dataPayload, currentRecord);
                    } else if (context.type === context.UserEventType.EDIT) {
                        log.debug('DEBUG', 'Editing an existing IF record');
                        var dataPayload = getDataPayload(context);
                        // Prepare the API call information
                        postToEditApi(dataPayload, currentRecord);

                    } else if (context.type === context.UserEventType.DELETE) {
                        cancelShipment(context);
                    }
                } catch (e) {
                    log.error('Error', e);
                }
            }

            log.debug('DEBUG', 'End beforeSubmit()');
        }

        function cancelShipment(context) {
            var currentRecord = context.oldRecord;
            var loadId = currentRecord.getValue({ fieldId: 'custbody_hyc_maersk_load_id' });

            log.debug('DEBUG', 'Cancel Shipment - loadId = ' + loadId);

            // Perform API call only when loadId exists
            if (loadId && loadId !== null && loadId !== '') {
                // Prepare the API call information
                var tokenRecord = helper.getTokenRecord();
                var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_oauth_access_token' });
                var url = tokenRecord.getValue({ fieldId: 'custrecord_hyc_oauth_endpoint' }) + "api/v1/CancelShipment";
    
                // payload data
                var dataPayload = { "loadId": loadId };
                var ret = helper.postToApi(bearerToken, url, JSON.stringify(dataPayload));
    
                try {
                    // Assume the cancel is success and the return result is "true"
                    if (Boolean(ret.result)) {
                        log.debug('DEBUG', 'shipment cancelled, loadId = ' + loadId);
                    } else {
                        log.debug('DEBUG', 'ret.result = ' + ret.result);
                    }
                } catch (e) {
                    log.error('Error', e);
                }            
            }
            
        }

        function getDataPayload(context) {
            var currentRecord = context.newRecord;
            var loadId;

            if (context.type === context.UserEventType.EDIT) {
                loadId = currentRecord.getValue({ fieldId: 'custbody_hyc_maersk_load_id' });
                log.debug('DEBUG', '[EDIT] loadId = ' + loadId);
            }
            // Prepare all the shippment information
            log.debug('DEBUG', 'customform = ' + currentRecord.getValue({ fieldId: 'customform' }));
            log.debug('DEBUG', 'shipaddress = ' + currentRecord.getValue({ fieldId: 'shipaddress' }));
            log.debug('DEBUG', 'shipcountry = ' + currentRecord.getValue({ fieldId: 'shipcountry' }));
            log.debug('DEBUG', 'shippingaddress = ' + currentRecord.getValue({ fieldId: 'shippingaddress' }));
            log.debug('DEBUG', 'shipaddr1 = ' + currentRecord.getValue({ fieldId: 'shipaddr1' }));
            log.debug('DEBUG', 'shipaddr2 = ' + currentRecord.getValue({ fieldId: 'shipaddr2' }));
            log.debug('DEBUG', 'shipaddr3 = ' + currentRecord.getValue({ fieldId: 'shipaddr3' }));
            log.debug('DEBUG', 'shipaddr3 = ' + currentRecord.getValue({ fieldId: 'shipaddr3' }));
            log.debug('DEBUG', 'shipaddr3 = ' + currentRecord.getValue({ fieldId: 'shipaddr3' }));
            log.debug('DEBUG', 'shipcity = ' + currentRecord.getValue({ fieldId: 'shipcity' }));
            log.debug('DEBUG', 'shipstate = ' + currentRecord.getValue({ fieldId: 'shipstate' }));
            log.debug('DEBUG', 'shipzip = ' + currentRecord.getValue({ fieldId: 'shipzip' }));
            log.debug('DEBUG', 'shipphone = ' + currentRecord.getValue({ fieldId: 'shipphone' }));
            log.debug('DEBUG', 'custbody_customer_phone_number = ' + currentRecord.getValue({ fieldId: 'custbody_customer_phone_number' }));
            log.debug('DEBUG', 'linkedtrackingnumbers = ' + currentRecord.getValue({ fieldId: 'linkedtrackingnumbers' }));
            log.debug('DEBUG', 'custbody_pro_number = ' + currentRecord.getValue({ fieldId: 'custbody_pro_number' }));
            log.debug('DEBUG', 'entity (Customer Internal ID) = ' + currentRecord.getValue({ fieldId: 'entity' }));
            log.debug('DEBUG', 'createdfrom (Order Internal ID) = ' + currentRecord.getValue({ fieldId: 'createdfrom' }));

            // Load the customer record
            var customerRecord = record.load({
                type: record.Type.CUSTOMER,
                id: currentRecord.getValue({ fieldId: 'entity' }),
                isDynamic: true
            });

            // Load the Sales Order record
            var salesOrderRecord = record.load({
                type: record.Type.SALES_ORDER,
                id: currentRecord.getValue({ fieldId: 'createdfrom' }),
                isDynamic: true
            });

            /**************************
            ***     Pickup Date     ***
            ***************************/
            //var pickupDate = helper.addBusinessDays(salesOrderRecord.getValue({ fieldId: 'trandate' }), 1);
            var pickupDate = new Date();

            // Convert the created date to the desired format
            var pickupDateStr = moment(pickupDate).format('YYYY-MM-DD');

            /**************************
            ***    Store Number     ***
            ***************************/
            var lbSourcedDataStr = salesOrderRecord.getValue({ fieldId: 'custbody_lb_sourced_data' });
            var lbSourceData = {};

            if (helper.isJSONString(lbSourcedDataStr)) {
                lbSourceData = JSON.parse(lbSourcedDataStr);
            }

            var storeNumber = '';

            // Store Number
            if (lbSourceData.hasOwnProperty('packSlipFields') &&
                lbSourceData.packSlipFields.hasOwnProperty('ShipTo') &&
                lbSourceData.packSlipFields.ShipTo.hasOwnProperty('AddressCode') &&
                lbSourceData.packSlipFields.ShipTo.AddressCode !== null &&
                lbSourceData.packSlipFields.ShipTo.AddressCode !== '') {
                storeNumber = lbSourceData.packSlipFields.ShipTo.AddressCode;
            } else if (lbSourceData.hasOwnProperty('packSlipFields') &&
                lbSourceData.packSlipFields.hasOwnProperty('OrderedBy') &&
                lbSourceData.packSlipFields.OrderedBy.hasOwnProperty('AddressCode') &&
                lbSourceData.packSlipFields.OrderedBy.AddressCode !== null &&
                lbSourceData.packSlipFields.OrderedBy.AddressCode !== '') {
                storeNumber = lbSourceData.packSlipFields.OrderedBy.AddressCode;
            }

            /**************************
            ***  Consignee Address  ***
            ***************************/
            var consigneeAddress = '';
            var consigneeAddress2 = '';
            var consigneeZip = '';
            var consigneeCountry = '';

            // First, try to lookup the Ship To Address from JSON field
            if (lbSourceData.hasOwnProperty('packSlipFields') &&
                lbSourceData.packSlipFields.hasOwnProperty('ShipTo') &&
                lbSourceData.packSlipFields.ShipTo.hasOwnProperty('Address1') &&
                lbSourceData.packSlipFields.ShipTo.Address1 !== null &&
                lbSourceData.packSlipFields.ShipTo.Address1 !== '') {

                consigneeAddress = lbSourceData.packSlipFields.ShipTo.Address1;

                // Address 2
                if (lbSourceData.packSlipFields.ShipTo.hasOwnProperty('Address2') &&
                    lbSourceData.packSlipFields.ShipTo.Address2 !== null &&
                    lbSourceData.packSlipFields.ShipTo.Address2 !== '') {
                    consigneeAddress2 = lbSourceData.packSlipFields.ShipTo.Address2;
                }

                // Zip
                if (lbSourceData.packSlipFields.ShipTo.hasOwnProperty('Zip') &&
                    lbSourceData.packSlipFields.ShipTo.Zip !== null &&
                    lbSourceData.packSlipFields.ShipTo.Zip !== '') {
                    consigneeZip = lbSourceData.packSlipFields.ShipTo.Zip;
                }

                // Country
                if (lbSourceData.packSlipFields.ShipTo.hasOwnProperty('Country') &&
                    lbSourceData.packSlipFields.ShipTo.Country !== null &&
                    lbSourceData.packSlipFields.ShipTo.Country !== '') {
                    consigneeCountry = lbSourceData.packSlipFields.ShipTo.Country;
                }
            } else {
                consigneeAddress = currentRecord.getValue({ fieldId: 'shipaddress' });
                var nameToRemove = customerRecord.getValue({ fieldId: 'firstname' }) + ' ' + customerRecord.getValue({ fieldId: 'lastname' }) + '\r\n';

                // Remove the substring from consigneeAddress
                consigneeAddress = consigneeAddress.replace(nameToRemove, '');
            }

            // Assign backup values from the sales order record if value cant be found in JSON
            consigneeZip = consigneeZip !== '' ? consigneeZip : currentRecord.getValue({ fieldId: 'shipzip' });
            consigneeCountry = consigneeCountry !== '' ? consigneeCountry : currentRecord.getValue({ fieldId: 'shipcountry' });

            /**************************
            ***   Ship To - Phone   ***
            ***************************/
            var shiptoPhone = '';
            if (lbSourceData.hasOwnProperty('packSlipFields') &&
                lbSourceData.packSlipFields.hasOwnProperty('ShipTo') &&
                lbSourceData.packSlipFields.ShipTo.hasOwnProperty('Phone') &&
                lbSourceData.packSlipFields.ShipTo.Phone !== null &&
                lbSourceData.packSlipFields.ShipTo.Phone !== '') {
                shiptoPhone = lbSourceData.packSlipFields.ShipTo.Phone;
            }

            // Get the phone number from sales order record if the JSON didnt contain such info
            shiptoPhone = shiptoPhone !== '' ? shiptoPhone : salesOrderRecord.getValue({ fieldId: 'custbody_customer_phone_number' });

            /**************************
            ***  Ship To - Contact  ***
            ***************************/
            var shiptoContact = '';
            if (lbSourceData.hasOwnProperty('packSlipFields') &&
                lbSourceData.packSlipFields.hasOwnProperty('ShipTo') &&
                lbSourceData.packSlipFields.ShipTo.hasOwnProperty('CompanyName') &&
                lbSourceData.packSlipFields.ShipTo.CompanyName !== null &&
                lbSourceData.packSlipFields.ShipTo.CompanyName !== '') {
                shiptoContact = lbSourceData.packSlipFields.ShipTo.CompanyName;
            }

            /*************************************
            ***  Tracking number from Package  ***
            **************************************/
            var proNumber = '';
            var items = [];

            var numPackages = currentRecord.getLineCount({ sublistId: 'package' });

            if (numPackages > 0) {
                // Initialize an array to store item data
                // Loop through each line item
                for (var i = 0; i < numPackages; i++) {
                    var pkgProductDescr = currentRecord.getSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagedescr',
                        line: i
                    });

                    // Find the index of the opening parenthesis "("
                    var openingParenIndex = pkgProductDescr.indexOf("(");

                    if (openingParenIndex !== -1) {
                        // Extract the product name from the beginning of the string up to the opening parenthesis
                        var productName = pkgProductDescr.substring(0, openingParenIndex).trim();

                        // Extract the quantity from the string starting from the opening parenthesis
                        var quantityString = pkgProductDescr.substring(openingParenIndex + 1, pkgProductDescr.length - 1).trim();

                        // Convert the quantity string to a floating-point number
                        var quantity = parseFloat(quantityString);

                        // Instead of search with the product name we'll lookup the product from the Item list from the Item Fulfillment record
                        var itemCount = currentRecord.getLineCount({
                            sublistId: 'item'
                        });

                        var itemRecord = null;
                        for (var j = 0; j < itemCount; j++) {
                            // Get the itemId from the sublist
                            var itemId = currentRecord.getSublistValue({
                                sublistId: 'item',
                                fieldId: 'item',
                                line: j
                            });

                            // Load the Item record
                            itemRecord = record.load({
                                type: search.lookupFields({ type: 'item', id: itemId, columns: 'recordtype' })['recordtype'],
                                id: itemId,
                                isDynamic: true
                            });

                            if (itemRecord.getValue({ fieldId: 'itemid' }) === productName) {
                                break;
                            } else {
                                itemRecord = null; // Set itemRecord to null to avoid the wrong item record is being selected
                                continue;
                            }
                        }

                        if (itemRecord !== null) {
                            var freightClass = itemRecord.getValue({ fieldId: 'custitem_fmt_freight_class' });
                            var itemWidth = itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_width' });
                            var itemLength = itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_length' });
                            var itemHeight = itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_height' });
                            var itemWeight = itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_weight' });
                            var itemDescription = '';

                            // Lookup the Product Category class
                            var productCatRecord = record.load({
                                type: record.Type.CLASSIFICATION,
                                id: itemRecord.getValue({ fieldId: 'class' }),
                                isDynamic: false
                            });

                            if (productCatRecord) {
                                itemDescription = productCatRecord.getValue({ fieldId: 'name' });
                            }

                            // Add item data to the array
                            items.push({
                                productDescription: itemDescription + ' - ' + productName + ' x' + quantity,
                                class: freightClass,
                                pieces: quantity,
                                weight: itemWeight,
                                isHazardous: false,
                                packaging: "pallets",
                                height: itemHeight,
                                length: itemLength,
                                width: itemWidth,
                                sealNumber: ""
                            });
                        }
                    }
                }

                // Get the tracking number from the first package
                proNumber = currentRecord.getSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagetrackingnumber',
                    line: 0 // Index of the first line
                });

                // Log or use the tracking number as needed
                log.debug('DEBUG', 'First Package Tracking Number = ' + proNumber);
            } else {
                // No packages found
                log.debug('DEBUG', 'No Packages Found - The Item Fulfillment record does not have any packages.');
            }

            // Get the first name and last name from customer record if the JSON didnt contain such info
            shiptoContact = shiptoContact !== '' ? shiptoContact : customerRecord.getValue({ fieldId: 'firstname' }) + ' ' + customerRecord.getValue({ fieldId: 'lastname' });

            log.debug('DEBUG', 'customerRecord.firstname = ' + customerRecord.getValue({ fieldId: 'firstname' }));
            log.debug('DEBUG', 'customerRecord.lastname = ' + customerRecord.getValue({ fieldId: 'lastname' }));
            log.debug('DEBUG', 'customerRecord.email = ' + customerRecord.getValue({ fieldId: 'email' }));
            log.debug('DEBUG', 'salesOrderRecord.otherrefnum = ' + salesOrderRecord.getValue({ fieldId: 'otherrefnum' }));
            log.debug('DEBUG', 'salesOrderRecord.trandate = ' + salesOrderRecord.getValue({ fieldId: 'trandate' }));
            log.debug('DEBUG', 'salesOrderRecord.shipaddress = ' + salesOrderRecord.getValue({ fieldId: 'shipaddress' }));
            log.debug('DEBUG', 'salesOrderRecord.shipphone = ' + salesOrderRecord.getValue({ fieldId: 'shipphone' }));
            log.debug('DEBUG', 'salesOrderRecord.custbody_customer_phone_number = ' + salesOrderRecord.getValue({ fieldId: 'custbody_customer_phone_number' }));
            log.debug('DEBUG', 'shiptoPhone = ' + shiptoPhone);
            log.debug('DEBUG', 'shiptoContact = ' + shiptoContact);
            log.debug('DEBUG', 'pickupDateStr = ' + pickupDateStr);
            log.debug('DEBUG', 'consigneeAddress = ' + consigneeAddress);
            log.debug('DEBUG', 'consigneeAddress2 = ' + consigneeAddress2);
            log.debug('DEBUG', 'consigneeZip = ' + consigneeZip);
            log.debug('DEBUG', 'consigneeCountry = ' + consigneeCountry);
            log.debug('DEBUG', 'proNumber = ' + proNumber);

            var dataPayload;

            if (context.type === context.UserEventType.CREATE) {            
                // payload data for CREATE
                dataPayload = {
                    'shipperZip': '91761',
                    'shipperCountry': 'US',
                    'consigneeZip': consigneeZip,
                    'consigneeCountry': consigneeCountry,
                    'shipmentMode': 'LTL',
                    'equipmentType': 'Van',
                    'items': items,
                    'shipperAddress': '701 Auto Center Dr',
                    'shipperName': 'homedepot.com',
                    'shipperContact': 'Order Department',
                    'shipperEmail': 'orders@water-creation.com',
                    'shipperPhone': '(909) 773-1777',
                    'consigneeAddress': consigneeAddress,
                    'consigneeAddress2': consigneeAddress2,
                    'consigneeName': shiptoContact,
                    'consigneeContact': shiptoContact,
                    'consigneeEmail': customerRecord.getValue({ fieldId: 'email' }),
                    'consigneePhone': shiptoPhone,
                    'poReference': currentRecord.getValue({ fieldId: 'custbody_sd_customer_po_no' }),
                    'shipperNumber': currentRecord.getValue({ fieldId: 'custbody_sd_customer_po_no' }),
                    'billOfLandingNote': '',
                    'pickupDate': pickupDateStr + 'T12:00:00.000Z',
                    'pickupOpenTime': pickupDateStr + 'T12:00:00.000Z',
                    'pickupCloseTime': pickupDateStr + 'T16:00:00.000Z',
                    'estimatedDelivery': pickupDateStr + 'T12:00:00.000Z',
                    'estimatedDeliveryOpenTime': pickupDateStr + 'T12:00:00.000Z',
                    'estimatedDeliveryCloseTime': pickupDateStr + 'T16:00:00.000Z',
                    'shipmentStatus': 'Booked',
                    'referenceNumber': storeNumber,
                    'carrier': {
                        'carrierScac': 'PAAF',
                        'providerScac': '',
                        'proNumber': proNumber // IF > Packages > PACKAGE TRACKING NUMBER
                    },
                    'test': false
                };
            } else if (context.type === context.UserEventType.EDIT) {
                // payload data for EDIT
                dataPayload = {
                    'loadId': loadId,
                    'shipperZip': '91761',
                    'shipperCountry': 'US',
                    'consigneeZip': consigneeZip,
                    'consigneeCountry': consigneeCountry,
                    'shipmentMode': 'LTL',
                    'equipmentType': 'Van',
                    'items': items,
                    'shipperAddress': '701 Auto Center Dr',
                    'shipperName': 'homedepot.com',
                    'shipperContact': 'Order Department',
                    'shipperEmail': 'orders@water-creation.com',
                    'shipperPhone': '(909) 773-1777',
                    'consigneeAddress': consigneeAddress,
                    'consigneeAddress2': consigneeAddress2,
                    'consigneeName': shiptoContact,
                    'consigneeContact': shiptoContact,
                    'consigneeEmail': customerRecord.getValue({ fieldId: 'email' }),
                    'consigneePhone': shiptoPhone,
                    'poReference': currentRecord.getValue({ fieldId: 'custbody_sd_customer_po_no' }),
                    'shipperNumber': currentRecord.getValue({ fieldId: 'custbody_sd_customer_po_no' }),
                    'billOfLandingNote': '',
                    // We are not updating these field
                    // 'pickupDate': pickupDateStr + 'T12:00:00.000Z',
                    // 'pickupOpenTime': pickupDateStr + 'T12:00:00.000Z',
                    // 'pickupCloseTime': pickupDateStr + 'T16:00:00.000Z',
                    // 'estimatedDelivery': pickupDateStr + 'T12:00:00.000Z',
                    // 'estimatedDeliveryOpenTime': pickupDateStr + 'T12:00:00.000Z',
                    // 'estimatedDeliveryCloseTime': pickupDateStr + 'T16:00:00.000Z',
                    // 'shipmentStatus': 'Booked',
                    'referenceNumber': storeNumber,
                    'carrier': {
                        'carrierScac': 'PAAF',
                        'providerScac': '',
                        'proNumber': proNumber // IF > Packages > PACKAGE TRACKING NUMBER
                    },
                    'test': false
                };
            }

            return dataPayload;
        }

        function postToCreateApi(dataPayload, currentRecord) {
            var tokenRecord = helper.getTokenRecord();
            var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_oauth_access_token' });
            var url = tokenRecord.getValue({ fieldId: 'custrecord_hyc_oauth_endpoint' }) + "api/v1/createshipment";

            // Create Shipment thru API
            log.debug('DEBUG', 'bearerToken = ' + bearerToken);
            log.debug('DEBUG', 'url = ' + url);
            log.debug('DEBUG', 'dataPayload = ' + JSON.stringify(dataPayload));
            var ret = helper.postToApi(bearerToken, url, JSON.stringify(dataPayload));

            if (ret.result.hasOwnProperty('loadId')) {
                // Update the Load ID to Sales Order record
                currentRecord.setValue({ fieldId: 'custbody_hyc_maersk_load_id', value: ret.result.loadId });
                // salesOrderRecord.setValue({fieldId: 'custbody_hyc_maersk_load_id', value: ret.result.loadId});
                log.debug('DEBUG', 'loadId = ' + ret.result.loadId);
            } else {
                log.debug('DEBUG', 'ret.result = ' + ret.result);
            }
        }

        function postToEditApi(dataPayload, currentRecord) {
            var tokenRecord = helper.getTokenRecord();
            var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_oauth_access_token' });
            var url = tokenRecord.getValue({ fieldId: 'custrecord_hyc_oauth_endpoint' }) + "api/v1/UpdateShipment";

            // Create Shipment thru API
            log.debug('DEBUG', 'bearerToken = ' + bearerToken);
            log.debug('DEBUG', 'url = ' + url);
            log.debug('DEBUG', 'dataPayload = ' + JSON.stringify(dataPayload));
            var ret = helper.postToApi(bearerToken, url, JSON.stringify(dataPayload));

            if (ret.result.hasOwnProperty('loadId')) {
                // Update the Load ID to Sales Order record
                currentRecord.setValue({ fieldId: 'custbody_hyc_maersk_load_id', value: ret.result.loadId });
                log.debug('DEBUG', '[EDIT] loadId = ' + ret.result.loadId);
            } else {
                log.debug('DEBUG', '[EDIT] ret.result = ' + ret.result);
            }
        }


        return {
            beforeSubmit: beforeSubmit
        };

    }
);
