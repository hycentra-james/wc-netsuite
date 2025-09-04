/*
 * ftpHelper.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
*/

define(['N/log', 'N/sftp'], 
    function (log, sftp) {

		/**
		* Get the SFTP Connection Object
		*
        * @param {Object} Customer record
		* @returns {Object} The SFTP Connection
		*/
		function getFTPConnection(customerRecord) {
            var connection; 

            // Extract the desired fields
            var companyName = customerRecord.getValue({ fieldId: 'companyname' });
            var host = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_host' });
            var port = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_port' });
            var username = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_username' });
            var password = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_password' });
            var passwordGuid = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_pwd_guid' });
            var secret = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_secret' });
            var hostKey = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_host_key' });
            var privateKeyId = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_pkeyid' });
            
            log.debug('DEBUG', 'companyName = ' + companyName);
            log.debug('DEBUG', 'host = ' + host);
            log.debug('DEBUG', 'port = ' + port);
            log.debug('DEBUG', 'username = ' + username);
            log.debug('DEBUG', 'password = ' + password);
            log.debug('DEBUG', 'passwordGuid = ' + passwordGuid);
            log.debug('DEBUG', 'secret = ' + secret);
            log.debug('DEBUG', 'hostKey = ' + hostKey);
            log.debug('DEBUG', 'privateKeyId = ' + privateKeyId);

			if (privateKeyId && privateKeyId !== null && privateKeyId !== '') {
                log.debug('DEBUG', 'Using Private Key');
                connection = sftp.createConnection({
                    username: username,
                    keyId: privateKeyId,
                    url: host,
                    port: parseInt(port.trim()),
                    directory: '/', // Set default directory to root
                    hostKey: hostKey
                });
            } else if (passwordGuid && passwordGuid !== null && passwordGuid !== '') {
                log.debug('DEBUG', 'Using passwordGuid');
                connection = sftp.createConnection({
                    username: username,
                    passwordGuid: passwordGuid, // Use passwordGuid if you have password instead of private key
                    url: host,
                    port: parseInt(port.trim()),
                    directory: '/', // Set default directory to root
                    hostKey: hostKey
                });
            } else if (secret && secret !== null && secret !== '') {
                log.debug('DEBUG', 'Using secret');
                connection = sftp.createConnection({
                    username: username,
                    secret: secret, // Use secret if you have secret instead of private key
                    url: host,
                    port: parseInt(port.trim()),
                    directory: '/', // Set default directory to root
                    hostKey: hostKey                    
                });
            }

            return connection;
		}

		return {
			getFTPConnection: getFTPConnection
		}
	}
);