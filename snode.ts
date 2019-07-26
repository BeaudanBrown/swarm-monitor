import { Network } from './network';
import { Message } from './message';
import { Account } from './account';

const multibase = require('multibase');

const hexIndex = multibase.names.indexOf('base16');
const hexCode = multibase.codes[hexIndex];

const base32zIndex = multibase.names.indexOf('base32z');
const base32zCode = multibase.codes[base32zIndex];

const allNodes: { [pubkey: string]: Snode } = {};

export class Snode {
  network: Network;
  pubkey: string;
  swarm_id: string;
  ip: string;
  port: string;
  messagesHolding: {[pubkey: string]: number} = {};
  lastHash: {[pubkey: string]: string} = {};

  constructor(pubkey: string, ip: string, port: string, swarm_id: string) {
    if (allNodes[pubkey]) {
      allNodes[pubkey].ip = ip;
      allNodes[pubkey].port = port;
      allNodes[pubkey].swarm_id = swarm_id;
      return allNodes[pubkey];
    }
    this.pubkey = pubkey;
    this.network = new Network();
    this.ip = ip;
    this.port = port;
    this.swarm_id = swarm_id;
    allNodes[pubkey] = this;
    return this;
  }

  static hexToSnodeAddress(hexAddress: string) {
    const buf = multibase.decode(`${hexCode}${hexAddress}`);
    const snodeAddress = multibase
      .encode(base32zCode, buf)
      .slice(1)
      .toString('utf8');
    return snodeAddress;
  }

  async sendMessage(message: Message) {
    const url = `https://${this.ip}:${this.port}/storage_rpc/v1`;
    const success = await this.network.sendToSnode(url, message);
    if (success) {
      message.markSent(this);
    }
    return success;
  }

  async retrieveAllMessages(pubKey: string) {
    let allMessages: Array<string> = [];
    let complete = false;
    this.lastHash[pubKey] = '';
    while (!complete) {
      const newMessages = await this._retrieveMessages(pubKey);
      complete = newMessages.length < 10;
      allMessages = allMessages.concat(newMessages);
    }
    this.messagesHolding[pubKey] = allMessages.length;
    return allMessages
  }

  async printStats(accounts: Array<Account>, shouldHave: number) {
    let inconsistent = false;
    let totalHolding = 0;
    accounts.forEach(account => {
      if (this.messagesHolding[account.pubKey]) {
        totalHolding += this.messagesHolding[account.pubKey];
      }
    });
    if (totalHolding !== shouldHave) {
      console.log(`Snode ${this.ip}:${this.port} should have ${shouldHave} but has ${totalHolding}`);
    } else {
      console.log(`Snode ${this.ip}:${this.port} has all ${shouldHave} messages`);
    }
  }

  private async _retrieveMessages(pubKey: string) {
    const url = `https://${this.ip}:${this.port}/storage_rpc/v1`;
    const messages = await this.network.retrieveFromSnode(url, pubKey, this.lastHash[pubKey]);
    this.lastHash[pubKey] = messages[messages.length - 1];
    return messages;
  }
}
