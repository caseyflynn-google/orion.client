/*******************************************************************************
 * Copyright (c) 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env node */
var express = require("express");
var bodyParser = require("body-parser");
var tasks = require("../tasks");
var target = require("./target");
var async = require("async");
var LRU = require("lru-cache-for-clusters-as-promised");

// Caching for already located targets
var orgsCache = new LRU({max: 1000, maxAge: 300000, namespace: "orgs_spaces"});

module.exports.router = function() {
	
	module.exports.getOrgsRequest = getOrgsRequest;

	return express.Router()
	.use(bodyParser.json())
	.get("*", getOrgs);
		
function getOrgs(req, res){
	var task = new tasks.Task(res,false,false,0,false);
	var resp = {};
	var targetRequest = JSON.parse(req.query.Target);
	getOrgsRequest(req.user.username, target.fullTarget(req,targetRequest))
	.then(function(orgsArray){
		resp = {
			"Orgs" : orgsArray.simpleorgsArray
		};
		task.done({
			HttpCode: 200,
			Code: 0,
			DetailedMessage: "OK",
			JsonData: resp,
			Message: "OK",
			Severity: "Ok"
		});
	}).catch(function(err){
		target.caughtErrorHandler(task, err);
	});
}

function getOrgsRequest(userId, targetRequest){
	var cacheKey = userId + targetRequest.Url;
	return orgsCache.get(cacheKey)
	.then(function(value) {
		if (value) {
			return value;
		}
		return target.cfRequest("GET", userId, targetRequest.Url + "/v2/organizations", {"inline-relations-depth":"1"}, null, null, null, targetRequest)
		// TODO In Java code, there is a case that Region is needed, but that value was always assigned as null.
		.then(function(result){
			var completeOrgsArray = [];
			var simpleorgsArray = [];
			completeOrgsArray = result.resources;
			return new Promise(function(fulfill,reject){
				if(completeOrgsArray){
					async.each(completeOrgsArray, function(resource, cb) {
						return target.cfRequest("GET", userId, targetRequest.Url + resource.entity.spaces_url, {"inline-relations-depth":"1"}, null, null, null, targetRequest)
						.then(function(spaceJson){	
							var spaces = [];
							var spaceResources = spaceJson && spaceJson.resources || [];
							for(var k = 0; k < spaceResources.length ; k++ ){
								spaces.push(resourceJson(spaceResources[k],"Space"));
							}
							var orgWithSpace = {};
							orgWithSpace = resourceJson(resource,"Org");
							orgWithSpace.Spaces = spaces;
							resource.Spaces = spaceResources;
							if(orgWithSpace.Spaces){
								simpleorgsArray.unshift(orgWithSpace);
							}else{
								simpleorgsArray.push(orgWithSpace);
							}
							cb();
						}).catch(function(err){
							cb(err);
						});
					}, function(err) {
						if(err){
							return reject(err);
						}
						var theOrgs = {"simpleorgsArray":simpleorgsArray,"completeOrgsArray":completeOrgsArray};
						orgsCache.set(cacheKey, theOrgs)
						.then(function() {
							fulfill(theOrgs);
						});
					});
				}
			});
		});
	});
}

function resourceJson(resource, type){
	return {
		"Guid": resource.metadata.guid,
		"Name": resource.entity.name,
		"Type": type
	};
}
};