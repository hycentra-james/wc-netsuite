/*
 * suppHelper.js
 * @NApiVersion 2.0
 * @NModuleScope Public
 */

define(['N/runtime', 'N/https', 'N/error', 'N/file'],
	function(runtime, https, error, file) {

		/**
		* Get the API URL endpoint from the custom preferences
		*
		* @returns {string} The URL string
		*/
		function getApiUrl() {
			var scriptObj = runtime.getCurrentScript();
			var endpoint = scriptObj.getParameter({name: 'custscript_lbsupp_apiendpoint'});

			if (endpoint == "1") {
				return 'https://stage.commerceapi.io/';
			}
			else if (endpoint == "2") {
				return 'https://commerceapi.io/';
			}
			else {
				log.error({
					title: 'PARAMETER ERROR',
					details: 'Unable to match value ' + endpoint + ' to an endpoint URL.'
				});
				return null;
			}
		}

		/**
		* Get the API key from the custom preferences
		*
		* @returns {string} The API key
		*/
		function getApiKey() {
			var scriptObj = runtime.getCurrentScript();
			var apiKey = scriptObj.getParameter({name: 'custscript_lbsupp_apikey'});
			return apiKey;
		}

		/**
		* Get the pull-from status from the custom preferences
		*
		* @returns {integer} The status number
		*/
		function getOrderPullStatus() {
			var scriptObj = runtime.getCurrentScript();
			var status = scriptObj.getParameter({name: 'custscript_lbsupp_orderpullfromstatus'});
			return status;
		}

		/**
		* Get the update-to status from the custom preferences
		*
		* @returns {integer} The status number
		*/
		function getOrderUpdateStatus() {
			var scriptObj = runtime.getCurrentScript();
			var status = scriptObj.getParameter({name: 'custscript_lbsupp_orderupdatetostatus'});
			return status;
		}

		/**
		* Get the cancellation ack pull-from status from the custom preferences
		*
		* @returns {integer} The status number
		*/
		function getAckPullStatus() {
			var scriptObj = runtime.getCurrentScript();
			var status = scriptObj.getParameter({name: 'custscript_lbsupp_ackpullfromstatus'});
			return status;
		}

		/**
		* Get the cancellation ack update-to status from the custom preferences
		*
		* @returns {integer} The status number
		*/
		function getAckUpdateStatus() {
			var scriptObj = runtime.getCurrentScript();
			var status = scriptObj.getParameter({name: 'custscript_lbsupp_ackupdatetostatus'});
			return status;
		}

		/**
		* Get the array of saved searches (space or comma separated) from the custom preferences
		*
		* @returns {array} The list of saved searches
		*/
		function getSavedSearchIds() {
			var scriptObj = runtime.getCurrentScript();
			var idstring = scriptObj.getParameter({name: 'custscript_lbsupp_savedsearchids'});
			if (idstring) {
				var ids = idstring.split(/[ ,]+/);
				return ids;
			}
			return [];
		}

		/**
		* Get the array of customers whose shipments should not be sent to LB from the custom preferences
		*
		* @returns {array} The list of excluded customer IDs
		*/
		function getExcludedCustomers() {
			var scriptObj = runtime.getCurrentScript();
			var idstring = scriptObj.getParameter({name: 'custscript_lbsupp_excludeship'});
			if (idstring) {
				var ids = idstring.split(/[ ,]+/);
				return ids;
			}
			return [];
		}

		/**
		 * Check if using Logicbroker Packages tab for sending shipments to LB
		 *
		 * @returns {boolean} Logicbroker Packages?
		 */
		function useLogicbrokerPackages() {
			var scriptObj = runtime.getCurrentScript();
			var useLBPackages = scriptObj.getParameter({name: 'custscript_lbsupp_uselbpackages'});
			return useLBPackages;
		}

		/**
		 * Check if inventory should be broadcast
		 *
		 * @returns {boolean} Broadcast?
		 */
		function broadcastInventory() {
			var scriptObj = runtime.getCurrentScript();
			var broadcast = scriptObj.getParameter({name: 'custscript_lbsupp_broadcast'});
			return broadcast;
		}

		/**
		* Append subscription key (API key) to a URL (Internal function)
		*
		* @param {string} url The starting URL
		* @returns {string} authUrl The URL with the subscription key appended
		*/
		function addSubKey(url) {
		    var authUrl = url;
		    if (url.indexOf('?') !== -1) {
		        authUrl += '&subscription-key=' + getApiKey();
		    } else {
		        authUrl += '?subscription-key=' + getApiKey();
		    }
		    return authUrl;
		};

		/**
		* Get if production endpoint is being used
		*
		* @returns {boolean} True if production endpoint is being used
		*/
		function isProduction() {
		    var url = getApiUrl();
		    var match = 'https://commerceapi.io';
		    return url.length >= match.length && url.indexOf(match) !== -1;
		};

		/**
		* Create a failed event in the Logicbroker system
		*
		* @param {string} apiUrl The base API URL
		* @param {string} docType Order, Shipment, Invoice
		* @param {Object} document The document to create an event on, null to create general failed event
		* @param {string} message The details of the failure
		*/
		function createFailedImportEvent(apiUrl, docType, document, message) {
			if (!docType) {
				docType = '';
			}
			if (document == null) {
				try {
					var data = {
						Summary: 'Failed to import ' + docType + ' into NetSuite',
						Details: message,
						Level: 'Alert',
						TypeId: 57
					};
					postToApi(apiUrl + 'api/v1/activityevents/', JSON.stringify(data));
				} catch (e) {
					log.error({
						title: 'ERROR',
						details: 'Error creating failed event: ' + e.message
					});
				}
			} else {
				var key = document.Identifier.LogicbrokerKey;
				try {
					var data = {
						LogicbrokerKey: key,
						Summary: 'Failed to import ' + docType + ' into NetSuite',
						Details: message,
						Level: 'Alert',
						TypeId: 57,
						ReceiverId: document.SenderCompanyId
					};
					postToApi(apiUrl + 'api/v1/activityevents/', JSON.stringify(data));
				} catch (e) {
					log.error({
						title: 'ERROR',
						details: 'Error creating failed document event for ' + docType + ' ' + key + ': ' + e.message
					});
				}
			}
		};

		/**
		* Create a failed event in the Logicbroker system
		*
		* @param {string} apiUrl The base API URL
		* @param {string} docType Order, Shipment, Invoice
		* @param {string} docNum The NetSuite document number that's failing
		* @param {Object} doc The JSON object attempting to export to Logicbroker
		* @param {string} lbKey The Logicbroker Key of the document to create the failed event on
		* @param {string} message The details of the failure
		*/
		function createFailedExportEvent(apiUrl, docType, docNum, doc, lbKey, message) {
			if (!docNum) {
				docNum = '';
			}
			if (doc) {
				var type = (docType == 'inventory') ? 'csv' : 'json';
				var docUrl = uploadAttachment('NetSuite failed ' + docType + ' ' + docNum, doc, type);
				if (docUrl) {
					message = message + '\n Download failed document <a href="' + docUrl + '">here</a>.';
				}
			}
			if (lbKey == null) {
				try {
					var data = {
						Summary: 'Failed to export ' + docType + ' ' + docNum + ' from NetSuite',
						Details: message,
						Level: 'Alert',
						TypeId: 57
					};
					postToApi(apiUrl + 'api/v1/activityevents/', JSON.stringify(data));
				} catch (e) {
					log.error({
						title: 'ERROR',
						details: 'Error creating failed event for ' + docType + ' ' + docNum +  ': ' + e.message
					});
				}
			} else {
				try {
					var data = {
						LogicbrokerKey: lbKey,
						Summary: 'Failed to export ' + docType + ' ' + docNum + ' from NetSuite',
						Details: message,
						Level: 'Alert',
						TypeId: 57
					};
					postToApi(apiUrl + 'api/v1/activityevents/', JSON.stringify(data));
				} catch (e) {
					log.error({
						title: 'ERROR',
						details: 'Error creating failed event for ' + docType + ' ' + docNum +  ': ' + e.message
					});
				}
			}
		}

		/**
		* Upload a JSON attachment to Logicbroker (Internal function)
		*
		* @param {string} description The description of the attachment
		* @param {Object} data The JSON object to upload
		* @returns {string} The url of the uploaded attachment, or null if there was an issue
		*/
		var uploadAttachment = function (description, data, type) {
			var url = getApiUrl() + 'api/v1/attachments?type=' + type + '&description=' + encodeURI(description);
			try {
				if (type == 'json') {
					data = JSON.stringify(data, null, 4);
				}
				var result = JSON.parse(postToApi(url, data).Result);
				if (result.hasOwnProperty('Body') && result.Body.hasOwnProperty('Records') && result.Body.Records.length > 0) {
					return result.Body.Records[0].Url;
				}
				return null;
			} catch(e) {
				log.error({ title: 'ERROR', details: 'Error uploading file attachment to Logicbroker: ' + e.message });
				return null;
			}
		}

		/**
		* Update a document's status in the Logicbroker system
		*
		* @param {string} apiUrl The Logicbroker endpoint configured by the user
		* @param {string} apiKey The Logicbroker API key configured by the user
		* @param {string} docType Order, Shipment, Acknowledgement
		* @param {string} key Logicbroker key
		* @param {string} status The status code to change the document to
		*/
		function updateDocumentStatus(apiUrl, apiKey, docType, key, status) {
			var retries = 3;
			var success = false;
			while (retries > 0 && success === false) {
				try {
					var url = apiUrl + 'api/v1/' + docType + 's/' + key + '/status/' + status + '?subscription-key=' + apiKey;
					var response = https.put({
						url: url,
						body: '{}',
						headers: {
							'Content-Type': 'application/json',
							Accept: 'application/json'
						}
					});
					success = true;
					if (response.code >= 400) {
						log.error({
							title: 'ERROR',
							details: 'Failed to update ' + docType + ' ' + key + ' to status ' + status + '.\n\nStatus code: ' + response.code + '\n\nResult: ' + response.body
						});
					}
				} catch (e) {
					retries--;
					log.error({
						title: 'ERROR',
						details: 'Error updating ' + docType + ' ' + key + ' to status ' + status + ': ' + e.message
					});
				}
			}
		};

		/**
		* POST call to the Logicbroker API
		*
		* @param {string} url The URL at which to make the POST request
		* @param {string} json The JSON string to post
		* @param {Array} path An array of strings indicating the path down the Response object that should be returned
		* @returns {Object} The API response, containing Status and Result
		*/
		function postToApi(url, json, path) {
			var authUrl = addSubKey(url);
			var retries = 3;
			var success = false;
			var response;
			while (retries > 0 && success === false) {
				try {
					response = https.post({
						url: authUrl,
						body: json,
						headers: {
							'Content-Type': 'application/json',
							Accept: 'application/json',
							SourceSystem: 'Netsuite'
						}
					});
					success = true;
				} catch (e) {
					retries--;
					if (retries === 0) {
						throw e;
					}
				}
			}
		    var ret = {};
		    ret.Status = response.code;
		    ret.Result = response.body;
		    if (!ret.Result || ret.Status >= 400) {
		        var eText = JSON.parse(ret.Result);
				var eMsg = eText.Message + '  ';

				if(eText.Body && Array.isArray(eText.Body)) {
					for (var i = 0; i < eText.Body.length; i++) {
						if (eText.Body[i].Errors) {
							for (var j = 0; j < eText.Body[i].Errors.length; j++) {
								eMsg = eMsg + eText.Body[i].Errors[j] + '  ';
							}
						}
					}
				}
				if (eText.Body && eText.Body.TransformationResults && eText.Body.TransformationResults.length > 0) {
					for (var k = 0; k < eText.Body.TransformationResults.length; k++) {
						eMsg = eMsg + eText.Body.TransformationResults[k].Message + '  ';
					}
				}

		        throw error.create({
		        	name: 'LOGICBROKER POST FAILED',
		        	message: 'Error posting data to API endpoint ' + url + '. API responded with status ' + ret.Status +
					'. API result: ' + eMsg
		        });
		    }
		    if (path != null && ret.Result != null) {
		        ret.Result = getObjectFromString(ret.Result, path);
		    }
		    return ret;
		}

		/**
		* GET call to the Logicbroker API
		*
		* @param {string} url The url at which to make the GET request
		* @param {Array} path An array of strings indicating the path down the Response object that should be returned
		* @returns {Object} The API response, containing Status and Result
		*/
		function getFromApi(url, path) {
			var authUrl = addSubKey(url);
			var retries = 3;
			var success = false;
			var response;
			while (retries > 0 && success === false) {
		    	try {
					response = https.get({
						url: authUrl,
						headers: {
							Accept: 'application/json'
						}
					});
					success = true;
				} catch (e) {
					retries--;
					if (retries === 0) {
						throw e;
					}
				}
			}
		    var ret = {};
		    ret.Status = response.code;
		    ret.Result = response.body;
		    if (!ret.Result || ret.Status >= 400) {
		        var eText = JSON.parse(ret.Result);
				var eMsg = eText.Message + '  ';

				if(eText.Body && Array.isArray(eText.Body)) {
					for (var i = 0; i < eText.Body.length; i++) {
						if (eText.Body[i].Errors) {
							for (var j = 0; j < eText.Body[i].Errors.length; j++) {
								eMsg = eMsg + eText.Body[i].Errors[j] + '  ';
							}
						}
					}
				}
				if (eText.Body && eText.Body.TransformationResults && eText.Body.TransformationResults.length > 0) {
					for (var k = 0; k < eText.Body.TransformationResults.length; k++) {
						eMsg = eMsg + eText.Body.TransformationResults[k].Message + '  ';
					}
				}

		        throw error.create({
		        	name: 'LOGICBROKER GET FAILED',
		        	message: 'Error getting API response from ' + url + '. API responded with status ' + ret.Status +
					'. API result: ' + eMsg
		        });
		    }
		    if (path != null && ret.Result != null) {
		        ret.Result = getObjectFromString(ret.Result, path);
		    }
		    return ret;
		}

		/**
		* Extract an object from a JSON string by drilling down a path (an array of strings)
		*
		* @param {string} objStr The JSON string
		* @param {Array} path An array of strings indicating the path down the JSON object that should be returned
		* @returns {Object} The extracted object
		*/
		function getObjectFromString(objStr, path) {
		    var obj = JSON.parse(objStr);
		    var ct = path.length;
		    for (var i = 0; i < ct; i += 1) {
		        var partial = path[i];
		        if (obj !== null && Object.prototype.hasOwnProperty.call(obj, partial) && obj[partial] !== null
		                && ((i < ct - 1 && obj[partial].toString() === '[object Object]') || (i === ct - 1))) {
		            obj = obj[partial];
		        }
		    }
		    return obj;
		}

		/* Solution from https://stackoverflow.com/questions/46954507/in-netsuite-with-suitescript-2-0-unable-to-send-a-file-with-http-post-request-wi */
	    function isFile(o) {
	        return (typeof o == 'object' && typeof o.fileType != 'undefined');
	    }

	    /**
	     * Creates a multipart upload
	     * @param {string} url     to post to
	     * @param {object} headers key/value of headers; include Auth headers if needed
	     * @param {array} parts   array of {name:string, value:file|string}
	     */
	    function postFileToApi(url, headers, parts) {
	    	var authUrl = addSubKey(url);
	        var boundary = 'someuniqueboundaryasciistring';
	        headers['content-type'] = 'multipart/form-data; boundary=' + boundary;
	        // Body
	        var body = [];
	        parts.forEach(function (p, idx) {
	            var partIsFile = isFile(p.value);
	            body.push('--' + boundary);
	            body.push('Content-Disposition: form-data; name="' + p.name + '"' + (partIsFile ? ('; filename="' + p.value.name + '"') : ''));
	            if (partIsFile) {
	                body.push('Content-Type: text/csv;charset=UTF-8');
	            }
	            body.push('');
	            body.push(partIsFile ? p.value.getContents() : p.value);
	            if (idx == parts.length - 1) {
	                body.push('--' + boundary + '--');
	                body.push('');
	            }
	        });
			// Submit Request
			var retries = 3;
			var success = false;
			var response;
			while (retries > 0 && success === false) {
				try {
					response = https.post({
						url: authUrl,
						headers: headers,
						body: body.join('\r\n')
					});
					success = true;
				} catch (e) {
					retries--;
					if (retries === 0) {
						throw e;
					}
				}
			}
            var ret = {};
		    ret.Status = response.code;
		    ret.Result = response.body;
		    if (!ret.Result || ret.Status >= 400) {
		        var eText = JSON.parse(ret.Result);
				var eMsg = (eText.hasOwnProperty('Message') ? eText.Message : JSON.stringify(eText));
				var fullMsg = 'Error posting multipart file to Logicbroker.\n\nAPI responded with status ' + ret.Status +
				'.\n\nAPI result: ' + eMsg;
		        throw error.create({
		        	name: 'POST FAILED',
		        	message: fullMsg
		        });
		    }
		    return ret;
	    }

	    /**
         * Get a list of all custom body fields on a record
         *
         * @param {Record} rec A record to extract the list from
         * @returns {Array} The array of custom field names
         */
        function getCustBodyFields(rec) {
        	var custFields = [];
        	var fields = rec.getFields();
        	fields.forEach(function (field) {
        		if (field.indexOf('custbody') === 0) {
        			custFields.push(field);
        		}
        	});
            return custFields;
        }

        /**
         * Get a list of all custom line fields on a record
         *
         * @param {Record} rec A record to extract the list from
         * @returns {Array} The array of custom field names
         */
        function getCustLineFields(rec) {
        	var custFields = [];
        	var fields = rec.getSublistFields({
        		sublistId: 'item'
        	});
        	fields.forEach(function (field) {
        		if (field.indexOf('custcol') === 0) {
        			custFields.push(field);
        		}
        	});
            return custFields;
        }

        /**
        * Get a value from a kvp
        *
        * @param {Array} kvpList The list of key value pairs to search through
        * @param {string} kvpName The name of the kvp to look for
        * @returns {string} The value associated with the kvp if found, null otherwise
        */
        var getKeyValue = function (kvpList, kvpName) {
           if (kvpList == null) {
               return null;
           }
           for (var i = 0; i < kvpList.length; i += 1) {
               var kvp = kvpList[i];
               if (kvp.Name === kvpName) {
                   if (Object.prototype.hasOwnProperty.call(kvp, 'Value')) {
                       return kvp.Value;
                   }
                   return null;
               }
           }
           return null;
	    };

		return {
			getApiUrl: getApiUrl,
			getApiKey: getApiKey,
			getOrderPullStatus: getOrderPullStatus,
			getOrderUpdateStatus: getOrderUpdateStatus,
			getAckPullStatus: getAckPullStatus,
			getAckUpdateStatus: getAckUpdateStatus,
			getSavedSearchIds: getSavedSearchIds,
			getExcludedCustomers: getExcludedCustomers,
			useLogicbrokerPackages: useLogicbrokerPackages,
			broadcastInventory: broadcastInventory,
			isProduction: isProduction,
			createFailedImportEvent: createFailedImportEvent,
			createFailedExportEvent: createFailedExportEvent,
			updateDocumentStatus: updateDocumentStatus,
			postToApi: postToApi,
			getFromApi: getFromApi,
			getObjectFromString: getObjectFromString,
			postFileToApi: postFileToApi,
			getCustBodyFields: getCustBodyFields,
			getCustLineFields: getCustLineFields,
			getKeyValue: getKeyValue,
		}
	}
);