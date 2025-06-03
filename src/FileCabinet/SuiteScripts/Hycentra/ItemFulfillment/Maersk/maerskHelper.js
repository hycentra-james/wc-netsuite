/*
 * helper.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
*/

define(['N/runtime', 'N/record', 'N/format', 'N/https', 'N/error', 'N/log'],
	function(runtime, record, format, https, error, log) {
		const CONFIG_RECORD_TYPE = 'customrecord_hyc_oauth_token';
		const CONFIG_RECORD_ID = 2; // HARDCODED to use record ID = 1

		/**
		* Get the API URL endpoint from the custom preferences
		*
		* @returns {string} The URL string
		*/
		function getApiUrl() {
			// Get Token
			var tokenRecord = getTokenRecord();

			if (!tokenRecord.isEmpty) {
				return tokenRecord.getValue({fieldId: 'custrecord_hyc_oauth_endpoint'});
			} else {
				return "https://homedepot.maersk.com/";
			}
		}

		/**
		* Get the API configuration record
		*
		* @returns {record} The Maersk configuration token record
		*/
		function getTokenRecord() {
			log.debug('DEBUG', 'getTokenRecord()::start');
			// Load the Token from configuration
			var tokenRecord = record.load({
				type: CONFIG_RECORD_TYPE,
				id: CONFIG_RECORD_ID 
			});

			// Check if the token is still valid
			tokenRecord = validateToken(tokenRecord);

			return tokenRecord;
		}

		function validateToken(tokenRecord) {
			try {
				var expirationDateObj = format.parse({
					value: tokenRecord.getValue({fieldId: 'custrecord_hyc_oauth_expiration'}),
					type: format.Type.DATETIMETZ
				});
	
				// Get the current date and time
				var nowDateObj = new Date();

				// Check if the token is expired yet
				if (expirationDateObj > nowDateObj) {
					log.debug('DEBUG', 'The token is still valid');
				} else {
					// Refresh the token
					log.debug('DEBUG', 'We need to renew the token');
					tokenRecord = refreshToken(tokenRecord);
				}
			} catch (e) {
				log.error({
					title: 'ERROR',
					details: 'Error validating token event: ' + e.message
				});
			}

			return tokenRecord;
		}

		function refreshToken(tokenRecord) {
			var apiUrl = tokenRecord.getValue({fieldId: 'custrecord_hyc_oauth_endpoint'}) + "connect/token";
			var clientId = tokenRecord.getValue({fieldId: 'custrecord_hyc_oauth_client_id'});
			var clientSecret = tokenRecord.getValue({fieldId: 'custrecord_hyc_oauth_secret'});
			var grantType = 'client_credentials';
	
			// Set up the request payload
			var payload = {
				'grant_type': grantType,
				'client_id': clientId,
				'client_secret': clientSecret
			};
	
			log.debug('DEBUG', 'refreshToken()::apiUrl = ' + apiUrl);
			// Make the HTTP POST request to obtain the bearer token
			var response = https.post({
				url: apiUrl,
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: payload
			});
	
			// Check the response status
			if (response.code === 200) {
				var responseBody = JSON.parse(response.body);
				var accessToken = responseBody.access_token;
				var expiresIn = responseBody.expires_in;
	
				log.debug('DEBUG', 'refreshToken()::accessToken = ' + accessToken);
				log.debug('DEBUG', 'refreshToken()::expiresIn = ' + expiresIn);
				
				// Update the access token
				updateAccessToken(accessToken, expiresIn);
				log.debug('DEBUG', 'refreshToken()::updateAccessToken success');
	
				return getTokenRecord();
			} else {
				log.error('DEBUG', 'HTTP Status Code: ' + response.code);
				log.error('DEBUG', 'Error Message: ' + response.body);
			}

			// Return the input token if token didn't refresh
			return tokenRecord;
		}

		function updateAccessToken(newAccessToken, expiresIn) {
			var recordId = 1;

			log.debug('DEBUG', 'updateAccessToken()::newAccessToken = ' + newAccessToken);
			log.debug('DEBUG', 'updateAccessToken()::expiresIn = ' + expiresIn);

			var expirationTimestamp = new Date().getTime() + (expiresIn * 1000);

			log.debug('DEBUG', 'updateAccessToken()::expirationTimestamp = ' + expirationTimestamp);
				
			// Update the record with the new access token and expiration value
			record.submitFields({
				type: CONFIG_RECORD_TYPE,
				id: CONFIG_RECORD_ID,
				values: {
					'custrecord_hyc_oauth_access_token': newAccessToken, 
					'custrecord_hyc_oauth_expiration': new Date(expirationTimestamp)
				}
			});

			log.debug('DEBUG', 'updateAccessToken() success');
		}
	

		/**
		* POST call to the Maersk API
		*
		* @param {string} token An array of strings indicating the path down the Response object that should be returned
		* @param {string} url The URL at which to make the POST request
		* @param {string} json The JSON string to post
		* @returns {Object} The API response, containing Status and Result
		*/
		function postToApi(token, url, json) {
			var retries = 3;
			var success = false;
			var response;
			while (retries > 0 && success === false) {
				try {
					response = https.post({
						url: url,
						body: json,
						headers: {
							'Authorization': 'Bearer ' + token,
							'Content-Type': 'application/json',
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

			log.debug('DEBUG', 'success = ' + success);
			log.debug('DEBUG', 'response.code = ' + response.code);
			log.debug('DEBUG', 'response.body = ' + response.body);

			var result = response.body;
			
			// Try to parse the result into JSON and will keep it's original format if it's not
			try {
                result = JSON.parse(result) 
            } catch (e) {
                log.debug('DEBUG', 'response.body is not JSON formatted string');
            }

		    var ret = {
				status: response.code,
				result: result
			};
			
		    if (!ret.result || ret.status >= 400) {
		        throw error.create({
		        	name: 'MAERSK API POST FAILED',
		        	message: 'Error posting data to API endpoint ' + url + '. API responded with status ' + ret.status +
					'. API response: ' + ret.result
		        });
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

		/**
         * This function is used to add a business days to a Date object
         *
         * @param {Date} baseDate The original Date
         * @param {int} daysToAdd Number of business days adding on top of the original Date
         * @returns {Date} The new date added with business days
         */
        function addBusinessDays(baseDate, daysToAdd) {
            var newDate = baseDate;
            var bussDayCounter = 0;
    
            while (bussDayCounter < daysToAdd) {
                newDate.setDate(newDate.getDate() + 1);
                if (newDate.getDay() === 0) {
                    newDate.setDate(newDate.getDate() + 1);
                } else if (newDate.getDay() === 6) {
                    newDate.setDate(newDate.getDate() + 2);
                }
                bussDayCounter++;
            }
    
            return newDate;
        }

		/**
         * This function to check if the string is JSON format
         *
         * @param {string} str The string to verify if it's JSON format
         * @returns {boolean} The string is a valid JSON
         */
		function isJSONString(str) {
			try {
				JSON.parse(str);
				return true;
			} catch (e) {
				return false;
			}
		}

		return {
			getTokenRecord: getTokenRecord,
			validateToken: validateToken,
			refreshToken: refreshToken,
			getApiUrl: getApiUrl,
			postToApi: postToApi,
			getFromApi: getFromApi,
			getObjectFromString: getObjectFromString,
			addBusinessDays: addBusinessDays,
			isJSONString: isJSONString,
		}
	}
);