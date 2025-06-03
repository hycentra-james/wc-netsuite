var mode;
var categoryVal;

function validatePageInit(type)
{	
	if(type == 'edit')
	{	
		mode = true;

		categoryVal = nlapiGetFieldValue('custrecord_fmt_item_category');
		//alert('category'+category);

	}
	else
	{
		mode = false;
	}
}
function onSaveValidateRec()
{
	var flag = true;

	//if(type == 'create' || type == 'copy')
	{
		var category = nlapiGetFieldValue('custrecord_fmt_item_category');
		//alert('category'+category);

		var filter = [];
		filter.push(new nlobjSearchFilter("custrecord_fmt_item_category",null,"anyof",category));

		var column = [];
		column[0] = new nlobjSearchColumn("custrecord_fmt_item_category");

		var search = nlapiSearchRecord('customrecord_fmt_item_configuration',null,filter,column)
		
		//alert('mode'+mode);

		if(search)
		{
			if((search.length>0) && (mode == false))
			{
				alert('You can not create this configuration record it is already present');
		        flag = false;
			}
			else if((search.length>0) && (category != categoryVal))
			{
				alert('You can not create this configuration record it is already present');
		        flag = false;
			}
		}
	}
	return flag;
}
