/**
 * Created by josematos on 09/12/2015.
 */

var express = require('express');
var moment = require('moment');
var Q = require('q');
//var app = express();
var fs = require('fs');
var ags = process.argv[2];
var http = require('http');

var hosts;
var categories = ['laptops', 'tvs', 'tablets'];
var flStream = fs.createWriteStream('data.txt');


function getHostandPath(resp) {
	var categoryMatch = /api\/(\w*)/g.exec(resp.req.path);
	var extIDmatch = /api\/\w*\/(\d*)\/bundles/g.exec(resp.req.path);

	return {
		host: resp.req._headers.host,
		path: resp.req.path,
		cat: categoryMatch ? categoryMatch[1] : '',
		extID: extIDmatch ? extIDmatch[1] : ''
	}
}

function getHostIdx(api, report) {
	var regex = new RegExp(api, 'g');
	var idx;
	for (idx = 0; idx < report.hosts.length; idx++) {
		if (regex.test(report.hosts[idx].url))
			return idx
	}
}

function getCatIdx(hostIdx, cat, report) {

	var c_idx;
	for (c_idx = 0; c_idx < report.hosts[hostIdx].categories.length; c_idx++) {
		if (report.hosts[hostIdx].categories[c_idx].category === cat)
			return c_idx;
	}
}

function getChunk(resp, endcallback, chunkParse, params) {

	var chunk = '';
	resp.setEncoding('utf8');

	resp.on("data", function(data) {
		chunk += data;
	});
	resp.on("end", function() {
		if (chunkParse)
			chunk = chunkParse(chunk);
		if (params && params.promise)
			params.promise.resolve('revolsed on getChunk');
		endcallback(chunk, params)
	});

}

function pushError(error, path) {
	console.log(error);
	report.errors.push({
		path: path,
		error: error
	});
}

function hostCheck(callback) {
	var hosts = require('./jsonHosts.json'),
		report = {
			hosts: []
		},
		hostIDX = 0,
		hostCounter = 0,
		hostLength = hosts.length;

	function checkHostHealth(response) {
		var hostnpath = getHostandPath(response);
		report.hosts.push({
			url: hostnpath.host,
			categories: [],
			health: response ? true : false
		});
		if (++hostCounter >= hostLength) callback(report);
	}

	for (; hostIDX < hostLength; hostIDX++) {
		http.get(hosts[hostIDX], checkHostHealth);
	}
}

function CategoriesPush(report, callback) {
	for (var host of report.hosts) {
		for (var cat of categories) {
			host.categories.push({
				category: cat,
				bundles: {},
				health: true
			});
		}
	}
	callback(report);
}

function CheckCrossCategories(report, nextstep) {
	var hostCounter = 0,
		callCounter = 0,
		callLength = report.hosts.length * 3;

	function getCrossCategory(resp) {

		var hostnpath = getHostandPath(resp);
		var hostIDX = getHostIdx(hostnpath.host, report);
		var catIDX = getCatIdx(hostIDX, hostnpath.cat, report);

		resp.setEncoding('utf8');
		resp.on("data", function(data) {
			report.hosts[hostIDX].categories[catIDX].crossCategories = {
				data: data,
				health: true
			};
			if (++callCounter >= callLength) nextstep(report);
		});
	}

	for (var host of report.hosts) {
		for (var cat of host.categories) {
			http.get({
				hostname: host.url,
				path: '/api/' + cat.category + '/crosscategories'
			}, getCrossCategory);
		}
	}
}

function ExternalIDsCheck(report, nextstep) {
	var callLength = report.hosts.length * 3,
		callCounter = 0;

	function getExtIds(response) {
		var pat = /externalID\":\"(\d*)/igm;
		var result;
		var extenralIDs = {},
			randomPicks = [];
		var host_n_cat = getHostandPath(response);
		var stop = 0,
			idx = 0;

		var h_index = getHostIdx(host_n_cat.host, report);
		var c_index = getCatIdx(h_index, host_n_cat.cat, report);

		getChunk(response, function(chunk, params) {
			while (result = pat.exec(chunk)) {
				extenralIDs[result[1]] = {};
			}
			while (stop < 10) {
				stop++;
				idx = UniqueIDX(report.hosts[h_index].categories[c_index].bundles, extenralIDs)
				report.hosts[h_index].categories[c_index].bundles[idx] = {};
			}
			if (++callCounter >= callLength) nextstep(report);

		}, null, {});
	}

	function UniqueIDX(arrRandom, arrAll) {
		var keys_a = Object.keys(arrAll);
		var returnee = null
		while (!returnee) {
			var idx = Math.floor(Math.random() * (keys_a.length - 0));
			returnee = arrRandom[keys_a[idx]] === undefined ? keys_a[idx] : null
		}
		return returnee;
	}

	for (var host of report.hosts) {
		for (var cat of host.categories) {
			http.get({
				hostname: host.url,
				path: '/api/' + cat.category
			}, getExtIds);
		}
	}
}

function CheckProductBundes(report, finalstep) {
	var hostIDX = 0,
		hostsLength = report.hosts.length,
		catIDX = 0,
		catLength = 3,
		callCounter = 0,
		callLength = hostsLength * 3 * 10;

	function singleBundleCheck(hostIDX, catIDX, extIDKey) {
		var crosscategoriesJSON = JSON.parse(report.hosts[hostIDX].categories[catIDX].crossCategories.data);
		var options = {
			hostname: report.hosts[hostIDX].url,
			path: '/api/' + report.hosts[hostIDX].categories[catIDX].category + '/' + extIDKey + '/' + 'bundles/?crosscategories=' + crosscategoriesJSON.join()
		};

		http.get(options, function(resp) {
			getChunk(resp, function(chunk) {
				//var headers=getHostandPath(resp);
				report.hosts[hostIDX].categories[catIDX].bundles[extIDKey].content = chunk;
				if (++callCounter >= callLength) finalstep(report);
			});
		});
	}

	for (; hostIDX < hostsLength; hostIDX++) {
		for (; catIDX < catLength; catIDX++) {
			var keys = Object.keys(report.hosts[hostIDX].categories[catIDX].bundles);
			var extIDsLength = keys.length;
			for (var extIDsIDX = 0; extIDsIDX < extIDsLength; extIDsIDX++)
				singleBundleCheck(hostIDX, catIDX, keys[extIDsIDX]);
		}
	}

}

function Iterator(obj, params, callback) {
	var hostIDX = 0,
		hostsLength = report.hosts.length,
		catIDX = 0,
		catLength = 3,
		callCounter = 0,
		callLength = hostsLength * 3 * 10;

	for (; hostIDX < hostsLength; hostIDX++) {
		for (; catIDX < catLength; catIDX++) {
			var keys = Object.keys(report.hosts[hostIDX].categories[catIDX].bundles);
			var extIDsLength = keys.length;
			for (var extIDsIDX = 0; extIDsIDX < extIDsLength; extIDsIDX++)
				singleBundleCheck(hostIDX, catIDX, keys[extIDsIDX]);
		}
	}
}

function writeReport(report) {
	var healthReport = '';
	console.log('writing report ');
	for (host of report.hosts) {
		flStream.write('host ' + host.url + '\n');
		healthReport += host.url + ' ' + (host.health ? ' OK' : 'NOK') + '\n';
		for (cat of host.categories) {
			healthReport += '\t' + cat.category + ' ' + (cat.health ? 'OK' : 'NOK') + '\n';
			flStream.write('\tcategory ' + '\n\t' + cat.category + '\n');
			var keys = Object.keys(cat.bundles);
			var extIDsLength = keys.length;
			for (var extIDsIDX = 0; extIDsIDX < extIDsLength; extIDsIDX++) {
				flStream.write('\t\t' + keys[extIDsIDX] + '\n\t\t\t' + cat.bundles[keys[extIDsIDX]].content + '\n');
				healthReport += '\t\t' + keys[extIDsIDX] + ' ' + (cat.bundles[keys[extIDsIDX]].content ? 'OK' : 'NOK') + '\n';
			}

		}
	}

	console.log(healthReport);
}

hostCheck(function(hostsHealth) {
	CategoriesPush(hostsHealth, function(cateoryHealth) {
		CheckCrossCategories(cateoryHealth, function(crossCategoryHealth) {
			ExternalIDsCheck(crossCategoryHealth, function(resp) {
				CheckProductBundes(resp, function(bundlesHealth) {
					console.log(hostsHealth === bundlesHealth);
					writeReport(bundlesHealth);
				});
			})
		})
	})
});