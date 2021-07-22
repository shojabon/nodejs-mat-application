let express = require("express");
let route = express();
let bodyParser = require('body-parser');
const axios = require('axios');

const crypto = require('crypto');

class MatEventObject{

    constructor(name, params, exception=false, response=false, target=undefined, responseId=undefined) {
        this.name = name;
        this.params = params;
        this.exception = exception;
        this.target = target;
        this.responseId = responseId;
        this.response = response;
    }

    data(){
        let target = {
            "name": this.name,
            "params": this.params,
            "exception": this.exception
        }
        if(this.responseId !== undefined){
            target["responseId"] = this.responseId;
        }
        if(this.response === true){
            target["response"] = this.response;
        }
        if(this.target !== undefined){
            target["target"] = this.target;
        }
        return target;
    }
}

class MatApplication{

    constructor(applicationName, ip, port, hookAddress, publicKey, secretKey, threadPool, timeout) {
        this.applicationName = applicationName;
        this.ip = ip;
        this.port = port;
        this.hookAddress = hookAddress;
        this.publicKey = publicKey;
        this.secretKey = secretKey;
        this.threadPool = threadPool;
        this.timeout = timeout;

        this.functionInformation = {};
        this.listeningEvents = {};
        this.__registerListener();

        this.waitingForResponse = [];
        this.responseTable = {};

        this.eventHandlerEndpoints = [];

    }
    //mat function decorator
    registerMatFunction(listeningEvents, callback, returnResponse, acceptOnlyWithResponseId, name, description, output, params){
        for(const eventName of listeningEvents){
            if(!(eventName in Object.keys(this.listeningEvents))){
                this.listeningEvents[eventName] = []
            }
            if(returnResponse === undefined){
                returnResponse = false;
            }
            if(acceptOnlyWithResponseId === undefined){
                acceptOnlyWithResponseId = false;
            }
            this.listeningEvents[eventName].push({
                "function": callback,
                "returnResponse": returnResponse,
                "acceptOnlyWithResponseId": acceptOnlyWithResponseId
            });
        }

        if(name !== undefined){
            this.functionInformation[this.applicationName + "." + name] = {
                "description": description,
                "output": output,
                "params": params
            }
        }
    }

    register_endpoint(endpoint){
        this.eventHandlerEndpoints.push(endpoint);
    }

    async send_event(event){
        if(!(event instanceof MatEventObject)){
            return new MatEventObject("event.invalid", {}, true).data();
        }
        if(this.eventHandlerEndpoints.length === 0){
            return new MatEventObject("endpoint.invalid", {}, true).data();
        }

        for(const endpoint of this.eventHandlerEndpoints){
            try{
                const data = Object.assign({}, event.data());
                data["publicKey"] = this.publicKey;
                const responseData = await this.__restPostToAddress(endpoint, this.secretKey, data);
                if(responseData["exception"]){
                    if(responseData["name"] === "target.invalid"){
                        return responseData;
                    }
                    continue;
                }

                if("responseId" in responseData["params"]){
                    const responseId = responseData["params"]["responseId"];
                    this.waitingForResponse.push(responseId);
                    await this.__wait_until(()=>{return responseId in this.responseTable}, this.timeout, 50);
                    this.waitingForResponse.splice(this.waitingForResponse.indexOf(responseId), 1);
                    if(responseId in this.responseTable){
                        const eventData = this.responseTable[responseId];

                        delete this.responseTable[responseId];

                        delete eventData["responseId"];
                        return eventData;
                    }else{
                        return new MatEventObject("response.timeout", {}, true).data();
                    }
                }
                return responseData
            }catch (ex){
            }
        }

        return new MatEventObject("endpoint.failed", {}, true).data();
    }

    __registerListener(){
        route.use(bodyParser.json());
        route.post(this.hookAddress, (req, res)=>{
            if(req.body === null || !("name" in req.body)){
                res.status(400);
                res.send("");
                return;
            }
            if(this.__verify_message(req.body, this.secretKey) === req.headers.v){
                this.__handle_event(req.body);
                res.send("");
                return;
            }
            res.status(400);
            res.send("");
        })
    }

    async __wait_until(condition, timeout, period){
        const mustend = Math.floor(new Date().getTime() / 1000) + timeout;
        while(Math.floor(new Date().getTime() / 1000) < mustend){
            if(condition()){return true}
            await new Promise(resolve => setTimeout(resolve, period));
        }
        return false;
    }

    __handle_event(event){
        if("responseId" in event && this.waitingForResponse.includes(event["responseId"])){
            this.responseTable[event["responseId"]] = event;
            return;
        }
        for(const eventName of Object.keys(this.listeningEvents)){
            if(eventName === event["name"] ||
                (eventName.includes("*") && event["name"].startsWith(eventName.replace("*", "")))){
                this.__execute_event(eventName, event);
            }
        }
    }

    async __restPostToAddress(url, secret, data){
        const dataCopy = Object.assign({}, data);
        try{
            const result = await axios.post(url, data, {headers: {'Content-Type': 'application/json',"v": this.__verify_message(dataCopy, secret)}});
            if(result.status !== 200){
                return null;
            }
            return result.data;
        }catch (error){
            return null;
        }
    }

    __execute_event(registeredEventName, event){
        if(!(registeredEventName in this.listeningEvents)){
            return;
        }
        for(const functionInfo of this.listeningEvents[registeredEventName]){

            if(functionInfo["acceptOnlyWithResponseId"] && !("responseId" in event)){
                return;
            }
            const result = functionInfo["function"](event);
            if(functionInfo["returnResponse"]){
                if("responseId" in event){
                    if(result instanceof MatEventObject){
                        if(result.name === undefined){
                            result.name = "response." + String(event["name"]);
                        }
                        result.responseId = event["responseId"];
                        this.send_event(result).then();
                        return;
                    }
                }

                if(result instanceof Object){
                    this.send_event(new MatEventObject("response." + String(event["name"]), result, false, undefined, event["responseId"])).then();
                    return;
                }

                if(result === undefined){
                    let resultObject = new MatEventObject("response.empty", {}, false)
                    resultObject.responseId = event["responseId"];
                    this.send_event(resultObject).then();
                    return;
                }

                let resultObject = new MatEventObject("response." + String(event["name"]), {"result": result}, false)
                resultObject.responseId = event["responseId"];
                this.send_event(resultObject).then();
                return;
            }

        }
    }

    __verify_message(payload, secret){
        return crypto.createHash('sha256').update(Buffer.from(JSON.stringify(payload)).toString("base64") + "." + secret, 'utf8').digest('hex');
    }

    start(){
        route.listen(this.port);
    }

}
module.exports = {
    "MatApplication": MatApplication,
    "MatEventObject": MatEventObject
}
