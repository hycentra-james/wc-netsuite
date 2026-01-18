/*
 * upsRateQuote.js
 * UPS Rating API functions
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/record', 'N/search', 'N/log', 'N/error', './upsHelper', '../FedEX/shippingWeightDimension'],
    function (record, search, log, error, upsHelper, shippingWeightDimension) {

        /**
         * Get UPS rate quote for a Sales Order
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {Object} { rate: number, apiResponse: Object } Shipping rate amount and API response
         */
        function getRateQuote(salesOrderRecord) {
            try {
                var shipMethodId = salesOrderRecord.getValue({ fieldId: 'shipmethod' });

                log.debug('UPS Rate Quote', 'Getting rate quote for Sales Order: ' + salesOrderRecord.id + ', Ship Method: ' + shipMethodId);

                // Get UPS service code from mapping
                var upsServiceCode = upsHelper.getUPSServiceCode(shipMethodId);
                log.debug('UPS Rate Quote', 'Using service code: ' + upsServiceCode);

                // Build rate quote payload
                var payload = buildRateQuotePayload(salesOrderRecord, upsServiceCode);

                // Get authentication token and API URL
                var tokenRecord = upsHelper.getTokenRecord();
                var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_access_token' });
                var baseApiUrl = upsHelper.getApiUrl();

                // Ensure baseApiUrl ends with trailing slash
                if (!baseApiUrl.endsWith('/')) {
                    baseApiUrl = baseApiUrl + '/';
                }

                // UPS Rating API v2409 (latest version)
                var apiUrl = baseApiUrl + 'api/rating/v2409/Rate';

                log.debug('UPS Rate Quote', 'API URL: ' + apiUrl);
                log.debug('UPS Rate Quote', 'Payload: ' + JSON.stringify(payload));

                // Make the API call
                var response = upsHelper.postToApi(bearerToken, apiUrl, JSON.stringify(payload));

                log.debug('UPS Rate Quote', 'Response Status: ' + response.status);
                log.debug('UPS Rate Quote', 'Response: ' + JSON.stringify(response.result));

                // Process response and extract rate
                if (response.status === 200 || response.status === 201) {
                    var rate = extractRateFromResponse(response.result, upsServiceCode);
                    log.debug('UPS Rate Quote', 'Extracted rate: ' + rate);
                    return {
                        rate: rate,
                        apiResponse: response.result
                    };
                } else {
                    var errorResponse = response.result || {};
                    throw error.create({
                        name: 'UPS_RATE_API_ERROR',
                        message: 'UPS Rate API returned status ' + response.status + ': ' + JSON.stringify(response.result),
                        apiResponse: errorResponse
                    });
                }

            } catch (e) {
                log.error({
                    title: 'UPS Rate Quote Error',
                    details: 'Error getting UPS rate quote: ' + e.message + '\nStack: ' + e.stack
                });
                if (e.apiResponse) {
                    e.apiResponse = e.apiResponse;
                }
                throw e;
            }
        }

        /**
         * Build rate quote payload for UPS API
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @param {string} upsServiceCode The UPS service code (e.g., '03' for Ground)
         * @returns {Object} Rate quote request payload
         */
        function buildRateQuotePayload(salesOrderRecord, upsServiceCode) {
            try {
                log.debug('Rate Quote Payload', 'Building payload for Sales Order: ' + salesOrderRecord.id);

                // Get account number
                var tokenRecord = upsHelper.getTokenRecord();
                var accountNumber = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_account_number' });

                // Load the Water Creation shipping label mapping record for shipper info
                var mappingRecord = record.load({
                    type: 'customrecord_hyc_shipping_label_mapping',
                    id: 10 // WC_UPS_MAPPING_RECORD_ID
                });

                // Calculate weight and dimensions
                var weightDimensionData = shippingWeightDimension.calculateSalesOrderWeightAndDimensions(salesOrderRecord);

                log.debug('Rate Quote Payload', 'Packages: ' + weightDimensionData.totalPackageCount + ', Total Weight: ' + weightDimensionData.totalWeight + ' lbs');

                // Build recipient info from Sales Order shipping address
                var recipientInfo = buildRecipientInfoFromSalesOrder(salesOrderRecord);

                // Build shipper info
                var shipperInfo = upsHelper.buildShipperInfo(null, mappingRecord);

                // Build package line items
                var packageLineItems = [];
                for (var i = 0; i < weightDimensionData.packages.length; i++) {
                    var pkg = weightDimensionData.packages[i];
                    var packageItem = {
                        PackagingType: {
                            Code: '02', // Customer Supplied Package
                            Description: 'Customer Supplied Package'
                        },
                        PackageWeight: {
                            UnitOfMeasurement: {
                                Code: 'LBS',
                                Description: 'Pounds'
                            },
                            Weight: String(parseFloat(pkg.weight) || 1)
                        }
                    };

                    // Add dimensions if available
                    if (pkg.dimensions && pkg.dimensions.length && pkg.dimensions.width && pkg.dimensions.height) {
                        packageItem.Dimensions = {
                            UnitOfMeasurement: {
                                Code: 'IN',
                                Description: 'Inches'
                            },
                            Length: String(parseFloat(pkg.dimensions.length) || 1),
                            Width: String(parseFloat(pkg.dimensions.width) || 1),
                            Height: String(parseFloat(pkg.dimensions.height) || 1)
                        };
                    }

                    packageLineItems.push(packageItem);
                }

                // Build UPS Rate Request payload
                var payload = {
                    RateRequest: {
                        Request: {
                            RequestOption: 'Rate' // Use 'Shop' to get all available rates
                        },
                        Shipment: {
                            Shipper: {
                                Name: shipperInfo.Name || 'Water Creation',
                                ShipperNumber: accountNumber,
                                Address: {
                                    AddressLine: shipperInfo.Address ? shipperInfo.Address.AddressLine : ['701 Auto Center Dr'],
                                    City: shipperInfo.Address ? shipperInfo.Address.City : 'Ontario',
                                    StateProvinceCode: shipperInfo.Address ? shipperInfo.Address.StateProvinceCode : 'CA',
                                    PostalCode: shipperInfo.Address ? shipperInfo.Address.PostalCode : '91761',
                                    CountryCode: shipperInfo.Address ? shipperInfo.Address.CountryCode : 'US'
                                }
                            },
                            ShipTo: {
                                Name: recipientInfo.Name || 'Customer',
                                Address: {
                                    AddressLine: recipientInfo.Address.AddressLine || ['Address Not Available'],
                                    City: recipientInfo.Address.City || 'Unknown',
                                    StateProvinceCode: recipientInfo.Address.StateProvinceCode || 'XX',
                                    PostalCode: recipientInfo.Address.PostalCode || '00000',
                                    CountryCode: recipientInfo.Address.CountryCode || 'US'
                                }
                            },
                            ShipFrom: {
                                Name: shipperInfo.Name || 'Water Creation',
                                Address: {
                                    AddressLine: shipperInfo.Address ? shipperInfo.Address.AddressLine : ['701 Auto Center Dr'],
                                    City: shipperInfo.Address ? shipperInfo.Address.City : 'Ontario',
                                    StateProvinceCode: shipperInfo.Address ? shipperInfo.Address.StateProvinceCode : 'CA',
                                    PostalCode: shipperInfo.Address ? shipperInfo.Address.PostalCode : '91761',
                                    CountryCode: shipperInfo.Address ? shipperInfo.Address.CountryCode : 'US'
                                }
                            },
                            Service: {
                                Code: upsServiceCode,
                                Description: getServiceDescription(upsServiceCode)
                            },
                            Package: packageLineItems
                        }
                    }
                };

                // Add residential indicator if applicable
                var isResidential = salesOrderRecord.getValue({ fieldId: 'shipisresidential' });
                if (isResidential) {
                    payload.RateRequest.Shipment.ShipTo.Address.ResidentialAddressIndicator = 'Y';
                }

                log.debug('Rate Quote Payload', 'Payload built successfully');
                return payload;

            } catch (e) {
                log.error({
                    title: 'Rate Quote Payload Error',
                    details: 'Error building rate quote payload: ' + e.message + '\nStack: ' + e.stack
                });
                throw e;
            }
        }

        /**
         * Build recipient information from Sales Order shipping address
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {Object} Recipient information in UPS format
         */
        function buildRecipientInfoFromSalesOrder(salesOrderRecord) {
            try {
                log.debug('Recipient Info', 'Building recipient info from Sales Order');

                // Try to get shipping address subrecord
                try {
                    var shippingAddressSubrecord = salesOrderRecord.getSubrecord({ fieldId: 'shippingaddress' });
                    if (shippingAddressSubrecord) {
                        var addr1 = shippingAddressSubrecord.getValue({ fieldId: 'addr1' });
                        var addr2 = shippingAddressSubrecord.getValue({ fieldId: 'addr2' });
                        var city = shippingAddressSubrecord.getValue({ fieldId: 'city' });
                        var state = shippingAddressSubrecord.getValue({ fieldId: 'state' });
                        var zip = shippingAddressSubrecord.getValue({ fieldId: 'zip' });
                        var countryId = shippingAddressSubrecord.getValue({ fieldId: 'country' });

                        // Convert country ID to country code
                        var countryCode = 'US';
                        if (countryId) {
                            try {
                                var countryRecord = record.load({ type: 'country', id: countryId });
                                countryCode = countryRecord.getValue({ fieldId: 'countrycode' }) || 'US';
                            } catch (countryError) {
                                log.debug('Country Lookup Warning', 'Could not load country ID: ' + countryId + ', using default US');
                            }
                        }

                        if (addr1 && city && state && zip) {
                            var addressLines = [addr1];
                            if (addr2) {
                                addressLines.push(addr2);
                            }

                            // Get residential value
                            var isResidential = salesOrderRecord.getValue({ fieldId: 'shipisresidential' });

                            return {
                                Name: shippingAddressSubrecord.getValue({ fieldId: 'attention' }) ||
                                    shippingAddressSubrecord.getValue({ fieldId: 'addressee' }) ||
                                    salesOrderRecord.getText({ fieldId: 'entity' }) ||
                                    'Customer',
                                Phone: {
                                    Number: upsHelper.validatePhoneNumber(shippingAddressSubrecord.getValue({ fieldId: 'addrphone' }))
                                },
                                Address: {
                                    AddressLine: addressLines,
                                    City: city,
                                    StateProvinceCode: state,
                                    PostalCode: zip,
                                    CountryCode: countryCode,
                                    ResidentialAddressIndicator: isResidential ? 'Y' : ''
                                }
                            };
                        }
                    }
                } catch (subrecordError) {
                    log.debug('Shipping Address Subrecord Warning', 'Could not access shippingaddress as subrecord: ' + subrecordError.message);
                }

                // Fallback: use customer address or default
                log.debug('Recipient Info Fallback', 'Using fallback address');
                return {
                    Name: salesOrderRecord.getText({ fieldId: 'entity' }) || 'Customer',
                    Phone: {
                        Number: '9999999999'
                    },
                    Address: {
                        AddressLine: ['Address Not Available'],
                        City: 'Unknown',
                        StateProvinceCode: 'XX',
                        PostalCode: '00000',
                        CountryCode: 'US'
                    }
                };

            } catch (e) {
                log.error({
                    title: 'Recipient Info Error',
                    details: 'Error building recipient info: ' + e.message
                });
                throw e;
            }
        }

        /**
         * Get UPS service description from code
         *
         * @param {string} serviceCode The UPS service code
         * @returns {string} Service description
         */
        function getServiceDescription(serviceCode) {
            var serviceMap = {
                '01': 'Next Day Air',
                '02': '2nd Day Air',
                '03': 'Ground',
                '12': '3 Day Select',
                '13': 'Next Day Air Saver',
                '14': 'Next Day Air Early',
                '59': '2nd Day Air A.M.',
                '65': 'UPS Saver',
                '93': 'SurePost Less Than 1lb',
                '92': 'SurePost 1lb or Greater'
            };

            return serviceMap[serviceCode] || 'UPS Service';
        }

        /**
         * Extract rate from UPS API response
         *
         * @param {Object} apiResponse The UPS API response
         * @param {string} upsServiceCode The UPS service code used in request
         * @returns {number} Shipping rate amount
         */
        function extractRateFromResponse(apiResponse, upsServiceCode) {
            try {
                log.debug('Extract Rate', 'Extracting rate from response for service: ' + upsServiceCode);

                // UPS Rate API response structure:
                // RateResponse.RatedShipment.TotalCharges.MonetaryValue
                // or RateResponse.RatedShipment[].TotalCharges.MonetaryValue for Shop request

                if (apiResponse && apiResponse.RateResponse && apiResponse.RateResponse.RatedShipment) {
                    var ratedShipment = apiResponse.RateResponse.RatedShipment;

                    // Handle array (Shop request) or single object (Rate request)
                    if (Array.isArray(ratedShipment)) {
                        // Shop request - find matching service
                        for (var i = 0; i < ratedShipment.length; i++) {
                            if (ratedShipment[i].Service && ratedShipment[i].Service.Code === upsServiceCode) {
                                if (ratedShipment[i].TotalCharges && ratedShipment[i].TotalCharges.MonetaryValue) {
                                    var rate = parseFloat(ratedShipment[i].TotalCharges.MonetaryValue);
                                    log.debug('Extract Rate', 'Found matching rate for ' + upsServiceCode + ': ' + rate);
                                    return rate;
                                }
                            }
                        }

                        // If no exact match, use first available rate
                        if (ratedShipment.length > 0 && ratedShipment[0].TotalCharges) {
                            var fallbackRate = parseFloat(ratedShipment[0].TotalCharges.MonetaryValue);
                            log.debug('Extract Rate', 'Using fallback rate: ' + fallbackRate);
                            return fallbackRate;
                        }
                    } else {
                        // Single Rate request response
                        if (ratedShipment.TotalCharges && ratedShipment.TotalCharges.MonetaryValue) {
                            var rate = parseFloat(ratedShipment.TotalCharges.MonetaryValue);
                            log.debug('Extract Rate', 'Found rate: ' + rate);
                            return rate;
                        }
                    }
                }

                throw error.create({
                    name: 'RATE_EXTRACTION_ERROR',
                    message: 'Could not extract rate from UPS API response. Response structure: ' + JSON.stringify(apiResponse)
                });

            } catch (e) {
                log.error({
                    title: 'Extract Rate Error',
                    details: 'Error extracting rate from response: ' + e.message
                });
                throw e;
            }
        }

        return {
            getRateQuote: getRateQuote,
            buildRateQuotePayload: buildRateQuotePayload,
            buildRecipientInfoFromSalesOrder: buildRecipientInfoFromSalesOrder,
            getServiceDescription: getServiceDescription,
            extractRateFromResponse: extractRateFromResponse
        };
    }
);
