/**
 * @NApiVersion 2.0
 * @NScriptType MapReduceScript
 */
define(['N/record','N/error','N/log','N/search','N/runtime','N/format'],
function(record,error,log,search,runtime,format){
	function getInputData(context)
	{
	 	try
	 	{
	 		var currentScript = runtime.getCurrentScript();

		   	var searchID = currentScript.getParameter({
			 	name: 'custscript_fmt_backorder_search'
		   	});

	 		var savedSearch = search.load({
		 		id : searchID
		 	});
		 	
		 	var resultSet = searchAll(savedSearch.run()); 

		 	if(resultSet)
		 	{
		 		var acceptValues = [];
		 		for(var i=0; i<resultSet.length; i++)
		 		{
			 		var docNo = resultSet[i].getValue({name: "tranid",summary: "GROUP",label: "Document Number"});
			 		var internalID = resultSet[i].getValue({name: "internalid",summary: "GROUP",sort: search.Sort.ASC,label: "Internal ID"});
			 			
			 		acceptValues.push
				 	({
				 		'documentNo': docNo,
				 		'id': internalID
				 	});
		 		}
		 	}
	 		    
		 	log.debug('acceptValues',acceptValues);
		 	return acceptValues;
	 	}
	 	catch(e)
		{
		 	log.debug('ERROR IN getData() FUNCTION',e.toString());
		}
	}

	function map(context)
	{
	 	try
	 	{
	 		log.audit('Enter in Map Function');

	 		var searchResult = JSON.parse(context.value);
	 		
	 		var _documentNo = searchResult.documentNo;
	 		var _id = searchResult.id;
	 		
	 		//log.debug('search result id', _id);

	 		context.write({
			key: _id,
			value: {
				'documentnum': _documentNo
				}
			});	
	 	}
		catch(e)
	 	{
	 		log.debug('ERROR IN map() FUNCTION', e);
	 	}
	}

	function reduce(context)
	{
		log.audit('Enter in Reduce Function');

		var mapKeyData = context.key;
		log.audit('mapKeyData', mapKeyData);

		//log.audit('context length', context.key.length);

	 	for (var j = 0; j < context.key.length; j++) 
	 	{ 
	 		var mapValueData = JSON.parse(context.values[j]); // Capture all values from Map function
			log.audit('Reduce Value', mapValueData); 

			var recObj = record.load({ 
				type: record.Type.SALES_ORDER, 
				id: mapKeyData,
				isDynamic: false
			});
			   	
			var itemLoc = recObj.getValue({
		    	fieldId: 'location'
		    });
			//log.audit('itemLoc', itemLoc);

			var fmtProcess = recObj.getValue({
		    	fieldId: 'custbody_fmt_process_for_backorder_flg'
		    });

			var soLineCount = recObj.getLineCount({
				'sublistId': 'item'
			});
			//log.audit('soLineCount', soLineCount);

			var itemArr = [];
			var so_locArr = [];
			var counter = 0;

			for(var q = 0; q < soLineCount; q++)
			{
				var item = recObj.getSublistValue({sublistId: 'item', fieldId: 'item', line: q});
				itemArr.push(item);

				var so_loc = recObj.getSublistValue({sublistId: 'item', fieldId: 'location', line: q});
				so_locArr.push(so_loc);
			}
				
			var callKitSearch = itemSearch(itemArr,so_locArr);
			log.debug('callKitSearch', JSON.stringify(callKitSearch));

			for(var w = 0; w < soLineCount; w++)
			{
				var so_backOrder = recObj.getSublistValue({sublistId: 'item', fieldId: 'quantitybackordered', line: w});
				var isClosed = recObj.getSublistValue({sublistId: 'item', fieldId: 'isclosed', line: w});
				var so_item = recObj.getSublistValue({sublistId: 'item', fieldId: 'item', line: w});
				var so_qty = recObj.getSublistValue({sublistId: 'item', fieldId: 'quantity', line: w});
				var qty_avail = recObj.getSublistValue({sublistId: 'item', fieldId: 'quantityavailable', line: w});
				
				if(so_backOrder > 0)
				{
					recObj.setSublistValue({
						sublistId: 'item',
						fieldId: 'isclosed',
						line: w,
						value: true
					});
				}
				else if((isClosed == true) && (callKitSearch) && (qty_avail >= so_qty))
				{
					if(callKitSearch[so_item] >= so_qty)
					{
						recObj.setSublistValue({
							sublistId: 'item',
							fieldId: 'isclosed',
							line: w,
							value: false
						});

						counter++;
					}
				}
			}

			if(counter == soLineCount)
			{
				recObj.setValue({
		            fieldId: 'custbody_fmt_process_for_backorder_flg',
		            value: true
	            });
			}
			else
			{
				for(var w1 = 0; w1 < soLineCount; w1++)
				{
					recObj.setSublistValue({
							sublistId: 'item',
							fieldId: 'isclosed',
							line: w1,
							value: true
						});
				}

				recObj.setValue({
		            fieldId: 'custbody_fmt_process_for_backorder_flg',
		            value: false
	            });
			}
				
			var recordId = recObj.save({enableSourcing: true,ignoreMandatoryFields: true});
			
	 	}
	}

 	
 	function itemSearch(itemArr,so_locArr)
 	{
 		log.audit('Kit Item search');

 		var itemSearchObj = search.create({
		   type: "item",
		   filters:
		   [
		      /*[[["type","anyof","InvtPart"],"AND",["inventorylocation","anyof",so_locArr],"AND",["locationquantityavailable","greaterthan","0"]],"OR",[["type","anyof","Kit"],"AND",["memberitem.inventorylocation","anyof",so_locArr]]], 
		      "AND", 
		      ["internalid","anyof",itemArr]*/

		      [[["type","anyof","InvtPart"],
			  "AND",
			  ["inventorylocation","anyof",so_locArr],
			  "AND",
			  ["locationquantityavailable","greaterthanorequalto","0"]],
			  "OR",
			  [["type","anyof","Kit"],
			  "AND",
			  ["memberitem.inventorylocation","anyof",so_locArr],
			  "AND",
			  ["memberitem.locationquantityavailable","greaterthanorequalto","0"]]], 
		      "AND", 
		      ["internalid","anyof",itemArr]
		   ],
		   columns:
		   [
		      search.createColumn({
		         name: "internalid",
		         sort: search.Sort.ASC,
		         label: "Internal ID"
		      }),
		      search.createColumn({name: "type", label: "Type"}),
		      search.createColumn({name: "inventorylocation", label: "Inventory Location"}),
		      search.createColumn({name: "locationquantityavailable", label: "Location Available"}),
		      search.createColumn({
		         name: "internalid",
		         join: "memberItem",
		         label: "Internal ID"
		      }),
		      search.createColumn({
		         name: "itemid",
		         join: "memberItem",
		         label: "Name"
		      }),
		      search.createColumn({
		         name: "inventorylocation",
		         join: "memberItem",
		         label: "Inventory Location"
		      }),
		      search.createColumn({
		         name: "locationquantityavailable",
		         join: "memberItem",
		         sort: search.Sort.ASC,
		         label: "Location Available"
		      }),
		      search.createColumn({name: "memberquantity", label: "Member Quantity"}),
		   ]
		});

		var firstResult = searchAll(itemSearchObj.run()); 

		var itemMap = {};

		for (var i2 = 0; i2 < firstResult.length; i2++) 
		{
		   var intID = firstResult[i2].getValue({name: "internalid",sort: search.Sort.ASC,label: "Internal ID"});
		   var kitAvailableQty = firstResult[i2].getValue({name: "locationquantityavailable",join: "memberItem",sort: search.Sort.ASC,label: "Location Available"});
		   var AvailableQty = firstResult[i2].getValue({name: "locationquantityavailable", label: "Location Available"});
		   var itemType = firstResult[i2].getValue({name: "type", label: "Type"});
		   
		   if(itemType == 'InvtPart' && AvailableQty > 0)
		   {
		   		kitAvailableQty = AvailableQty;
		   		log.audit('kitAvailableQty in If', kitAvailableQty);
		   }
		   else if(itemType == 'Kit' && (kitAvailableQty > 0) && (AvailableQty >= kitAvailableQty))
		   {
		   		if((!kitAvailableQty) && (itemMap[intID]))
		   		{
		   			itemMap[intID] = 0;
		   			log.audit('itemMap[intID]', itemMap[intID]);
		   		}
		   		else
		   		{
		   			kitAvailableQty = kitAvailableQty;
		   			log.audit('kitAvailableQty in else if', kitAvailableQty);
		   		}
		   	}

		   if((itemMap[intID]) && (kitAvailableQty > 0))
		   {
		   		itemMap[intID] = parseFloat(itemMap[intID]) + parseFloat(kitAvailableQty);//15+445
		   		log.audit('itemMap[intID] 282', itemMap[intID]);
		   }
		   else
		   {
		   		if((kitAvailableQty > 0))
		   		{
		   			itemMap[intID] = parseFloat(kitAvailableQty);//first time 15 
		   			log.audit('itemMap[intID] 287', itemMap[intID]);
		   		}
		   }

		   if(!kitAvailableQty)
		   {
		   		itemMap[intID] = 0; // if blank then set 0
		   }

		   //final 556
		}

		log.audit('itemMap ', itemMap);

		return itemMap;
 	}

	function searchAll(resultset) 
	{
		var allResults = [];
		var startIndex = 0;
		var RANGECOUNT = 1000;

		do 
		{
			var pagedResults = resultset.getRange({
				start: parseInt(startIndex),
				end: parseInt(startIndex + RANGECOUNT)
			});

			allResults = allResults.concat(pagedResults);
			//log.debug({title: '199',details: allResults});

			var pagedResultsCount = pagedResults != null ? pagedResults.length : 0;
			startIndex += pagedResultsCount;

			var remainingUsage = runtime.getCurrentScript().getRemainingUsage();
			//log.debug({title: '207', details: remainingUsage});
		}

		while (pagedResultsCount == RANGECOUNT);
		var remainingUsage = runtime.getCurrentScript().getRemainingUsage();
		//log.debug({title: '213', details: remainingUsage});

		return allResults;
	}

	return{
	 	getInputData : getInputData,
	 	map : map,
	 	reduce : reduce
	};
});
