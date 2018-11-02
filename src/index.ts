//Deps
require('babel-polyfill');
import * as crypto from 'crypto';
import * as Encryption from './encryption';
import * as pify from 'pify';
import * as converter from '@iota/converter';
import { composeAPI, createPrepareTransfers, API, createFindTransactions } from '@iota/core';
import { Transaction, Transfer } from '@iota/core/typings/types';
import { Mam } from './node'; //New binding?
import { Settings } from '@iota/http-client/typings/http-client/src/settings'; //Added for Provider typing
import * as Bluebird from 'bluebird'
import { stringify } from 'querystring';

//Setup Provider
let provider : string = null;
//let Mam = {};
//const setupEnv = rustBindings => (Mam = rustBindings);

/**
 * TODO: Add typing - Better use excisting typing in @iota/core and others?
 * 
 * Enums:
 * - Security
 * - Mode (Done)
 * 
 * Interfaces:
 * - Channel (Done)
 * - Transfers (Done)
 * - Return of Mam.createMessage
 * - Return of create
 * 
 * Types:
 * - Seed?
 * - Address?
 */

//NOTE: Rounds become part of the MAMStream, or can that change?

//Introduced a Enum for the mode with string values to allow backwards compatibility. Enum removes the need for string compare checks.
export enum MAM_MODE {
    PUBLIC,
    PRIVATE,
    RESTRICTED
}

export interface channel {
    side_key : string | null;
    mode : MAM_MODE;
    next_root : string | null;
    security : number; //Enum?
    start : number;
    count : number;
    next_count : number;
    index : number;
}

export class MamWriter {
    private provider : Partial<Settings>;
    private channel : channel;
    private seed : string;

    //Replaces init
    constructor(provider: string, seed : string = keyGen(81), security : number = 1) {
        //Set IOTA provider
        this.provider = { provider : provider };

        //Setup Personal Channel
        this.channel = {
            side_key: null,
            mode: MAM_MODE.PUBLIC,
            next_root: null,
            security : security, //This was not set in javascript version?
            start: 0,
            count: 1,
            next_count: 1,
            index: 0
        };
        //Set other variables (Old returned these)
        this.seed = seed;
    }

    public async createAndAttach(message : string) {
        let Result : {payload : string, root : string, address : string} = this.create(message);
        let Result2 = await this.attach(Result.payload, Result.address);
        return Result2;
    }

    public changeMode(mode : MAM_MODE, sideKey ?: string) : void {
        //Removed validation of mode
        if(mode == MAM_MODE.RESTRICTED && sideKey == undefined) {
            return console.log('You must specify a side key for a restricted channel');
        }
        //Only set sidekey if it isn't undefined (It is allowed to be null, but not undefined)
        if(sideKey) {
            this.channel.side_key = sideKey;
        }
        this.channel.mode = mode;
        //removed return of the state
    }

    public create(message : string, rounds : number = 81) : {payload : string, root : string, address : string} {
        //Interact with MAM Lib
        let TrytesMsg = converter.asciiToTrytes(message);
        const mam = Mam.createMessage(this.seed, TrytesMsg, this.channel.side_key, this.channel); //TODO: This could return an interface format

        //If the tree is exhausted
        if(this.channel.index == this.channel.count - 1) { //Two equals should be enough in typescript
            //change start to beginning of next tree.
            this.channel.start = this.channel.next_count + this.channel.start;
            //Reset index.
            this.channel.index = 0;
        } else {
            //Else step the tree.
            this.channel.index++;
        }

        //Advance Channel
        this.channel.next_root = mam.next_root;

        //Generate attachment address
        let address : string;
        if(this.channel.mode !== MAM_MODE.PUBLIC) {
            address = hash(mam.root, rounds);
        } else {
            address = mam.root;
        }

        return {
            //Removed state as it is now updated in the class
            payload: mam.payload,
            root: mam.root,
            address
        }
    }

    //Todo: Remove the need to pass around root as the class should handle it?
    public async attach(trytes : string, address : string, depth : number = 6, mwm : number = 12) : Promise<Transaction[]> {
        return new Promise<Transaction[]> ( (resolve, reject) => {
            let transfers : Transfer[];
            transfers = [ {
                address : address,
                value : 0,
                message : trytes
            }];
            for(let item in transfers){
                console.log( item + transfers[item].address)
                console.log("NOOOOOOOO")
            }
            const { sendTrytes } : any = composeAPI(this.provider);
            const prepareTransfers = createPrepareTransfers();

            prepareTransfers('9'.repeat(81), transfers, {})
            .then( (transactionTrytes) => {
                sendTrytes(transactionTrytes, depth, mwm)
                .then(transactions => {
                    resolve(<Array<Transaction>>transactions);
                })
                .catch(error => {
                    reject(`sendTrytes failed: ${error}`);
                });
            })
            .catch(error => {
                reject(`failed to attach message: ${error}`);
            });
        });
    }

    //Next root
    public getNextRoot() {
        return Mam.getMamRoot(this.seed, this.channel);
    }  
}

export class MamReader {
    private provider : Partial<Settings>;
    private sideKey : string | null = null;
    private mode : MAM_MODE;
    private nextRoot : string;

    constructor( provider : string, root : string, mode : MAM_MODE = MAM_MODE.PUBLIC, sideKey ?: string) {
        //Set the settings
        this.provider = { provider : provider };
        this.changeMode(root, mode, sideKey);
    }

    public changeMode(root : string, mode : MAM_MODE, sideKey ?: string) : void {
        if(mode == MAM_MODE.RESTRICTED && sideKey == undefined) {
            return console.log('You must specify a side key for a restricted channel');
        }
        if(sideKey) {
            this.sideKey = sideKey;
        }
        this.mode = mode;
        //Requires root to be set as the user should make a concise decision to keep the root the same, while they switch the mode (unlikely to be the correct call)
        this.nextRoot = root;
    } 

    public setRoot(root : string) : void { //TODO: Validation of the root as check if it is a valid root
        this.nextRoot = root;
    }

    public async fetchSingle (rounds : number = 81) : Promise<string> { //TODO: test, Returning a Promise correct?
        return new Promise<string> ((resolve, reject) => {
            let address : string = this.nextRoot;
            if( this.mode == MAM_MODE.PRIVATE || this.mode == MAM_MODE.RESTRICTED) {
                address = hash(this.nextRoot, rounds);
            }
            const { findTransactions } : any = composeAPI( this.provider);
            findTransactions({addresses : [address]})
            .then((transactionHashes) => {
                this.txHashesToMessages(transactionHashes)
                .then((messagesGen) => {
                    for( let maskedMessage of messagesGen) {
                        try {
                            //Unmask the message
                            const { message, nextRoot } = Decode(maskedMessage, this.sideKey, this.nextRoot);
                            this.nextRoot = nextRoot;
                            //Return payload
                            resolve( converter.trytesToAscii(message) );
                        } catch(e) {
                            reject(`failed to parse: ${e}`);
                        }
                    }
                })
                .catch((error) => {
                    reject(`txHashesToMessages failed with ${error}`);
                });
            })
            .catch((error) => {
                reject(`findTransactions failed with ${error}`);
            });             
        });
    }

    public async fetch(rounds : number = 81) : Promise<string[]> {
        return new Promise<string[]> (async (resolve, reject) => {
            //Set variables
            const messages : string[] = [];
            let consumedAll : boolean = false;

            while(!consumedAll) {
                //Apply channel mode
                let address : string = this.nextRoot;
                if(this.mode == MAM_MODE.PRIVATE || this.mode == MAM_MODE.RESTRICTED) {
                    address = hash(this.nextRoot, rounds);
                }

                const { findTransactions } : any = composeAPI( this.provider );
                await findTransactions({addresses : [address]})
                .then(async (transactionHashes) => {
                    console.log("then");
                    //If no hashes are found, we are at the end of the stream
                    if(transactionHashes.length == 0) {
                        consumedAll = true;
                    } else { //Continue gathering the messages
                        this.txHashesToMessages(transactionHashes)
                        .then((messagesGen) => {
                            for( let maskedMessage of messagesGen) {
                                try {
                                    //Unmask the message
                                    const { message, nextRoot } = Decode(maskedMessage, this.sideKey, this.nextRoot);
                                    //Store the result
                                    messages.push( converter.trytesToAscii(message) );
                                    this.nextRoot = nextRoot;
                                } catch(e) {
                                    reject(`failed to parse: ${e}`);
                                }
                            }
                        })
                        .catch((error) => {
                            reject(`txHashesToMessages failed with ${error}`);
                        });
                    }
                })
                .catch((error) => {
                    reject(`findTransactions failed with ${error}`);
                });
                console.log("Done");
            }
            resolve(messages);
        });
    }

    //Next root
    public getNextRoot() {
        return this.nextRoot;
    } 

    private async txHashesToMessages(hashes : Bluebird<ReadonlyArray<string>>) : Promise<string[]> {
        return new Promise<string[]> ((resolve, reject) => {
            let bundles : {index : number, signatureMessageFragment : string}[] = [];
    
            //For some reason this process supports multiple bundles. Keeping it as it might be a workaround for the length bug
            const processTx = function(txo : Transaction) : string {
                if(txo.bundle in bundles) {
                    bundles[txo.bundle].push({index : txo.currentIndex, signatureMessageFragment : txo.signatureMessageFragment});
                } else {
                    bundles[txo.bundle] = [{index : txo.currentIndex, signatureMessageFragment : txo.signatureMessageFragment}];
                }
        
                if(bundles[txo.bundle].length == txo.lastIndex + 1) {
                    //Gets the bundle
                    let txMessages : {index : number, signatureMessageFragment : string}[] = bundles[txo.bundle];
                    delete bundles[txo.bundle];
                    //Sorts the messages in the bundle according to the index
                    txMessages = txMessages.sort((a,b) => (b.index < a.index) ? 1 : -1);
                    //Reduces the messages to a single messages
                    let Msg : string = txMessages.reduce((acc, n) => acc + n.signatureMessageFragment, '');
                    return Msg;
                }
            }

            const { getTransactionObjects } : any = composeAPI( this.provider);
            getTransactionObjects(hashes)
            .then((objs) => {
                let proccesedTxs : string[] = objs.map(tx => processTx(tx));
                //Remove undefined from the list. Those are transactions that were not the last in the bundle
                proccesedTxs = proccesedTxs.filter(tx => tx !== undefined);
                resolve(proccesedTxs);
            })
            .catch((error) => {
                reject(`getTransactionObjects failed with ${error}`);
            });
        });
    }
}

//Export?
export function Decode(payload : string, side_key : string, root : string) : { message : string, nextRoot : string } {
    let Result : {payload : any, next_root : any} =  Mam.decodeMessage(payload, side_key, root);
    return {message: Result.payload, nextRoot : Result.next_root};
}

//Export?
export function hash (data, rounds = 81) {
    return converter.trytes(
        Encryption.hash( 
            rounds, //Removed the || statement with 81 as 81 is now default
            converter.trits(data.slice()) 
        ).slice()
    );
}

//Export?
export function keyGen(length : number) {
    const charset : string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ9';
    let key : string = '';
    while(key.length < length) {
        let byte : Buffer = crypto.randomBytes(1);
        if(byte[0] < 243) {
            key += charset.charAt(byte[0] % 27);
        }
    }
    return key;
}