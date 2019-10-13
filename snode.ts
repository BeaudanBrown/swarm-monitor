import { Network } from './network';
import { Message } from './message';

const multibase = require('multibase');

const hexIndex = multibase.names.indexOf('base16');
const hexCode = multibase.codes[hexIndex];

const base32zIndex = multibase.names.indexOf('base32z');
const base32zCode = multibase.codes[base32zIndex];


export class Snode {
  network: Network;
  pubkey: string;
  swarm_id: string;
  ip: string;
  port: string;
  messagesHolding: number;
  lastHash: string;
  lastUptimeProof: number;

  constructor(pubkey: string, ip: string, port: string, swarm_id: string, last_uptime: number) {

    this.pubkey = pubkey;
    this.network = new Network();
    this.ip = ip;
    this.port = port;
    this.messagesHolding = 0;
    this.lastHash = '';
    this.swarm_id = swarm_id;
    this.lastUptimeProof = last_uptime;
  }

  static hexToSnodeAddress(hexAddress: string) {
    const buf = multibase.decode(`${hexCode}${hexAddress}`);
    const snodeAddress = multibase
      .encode(base32zCode, buf)
      .slice(1)
      .toString('utf8');
    return snodeAddress;
  }

  static snodeAddressToHex(sn_addr: string) {

    const buf = multibase.decode(`${base32zCode}${sn_addr}`);
    const hex_addr = multibase.encode(hexCode, buf).slice(1).toString('utf8');
    return hex_addr;
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
    this.lastHash = '';
    while (!complete) {
      const newMessages = await this._retrieveMessages(pubKey);
      complete = newMessages.length < 10;
      allMessages = allMessages.concat(newMessages);
    }
    return allMessages
  }

  private async _retrieveMessages(pubKey: string) {
    const url = `https://${this.ip}:${this.port}/storage_rpc/v1`;
    const messages = await this.network.retrieveFromSnode(url, pubKey, this.lastHash);
    this.lastHash = messages[messages.length - 1];
    return messages;
  }
}
