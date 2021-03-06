import * as DataSync from './util/DataSync';
import * as Log from './util/Log';

import cache from './util/cache';

/**
 * Instant Message
 * @public
 */
export default class Message {
  /**
   * Create a message
   * @param {Webcom/api.DataSnapshot|Object} snapData The data snapshot
   * @param {string} roomId The message's room id
   * @access protected
   */
  constructor(snapData, roomId) {
    const values = Object.assign({}, snapData.val());
    /**
     * The message unique id
     * @type {string}
     */
    this.uid = snapData.name();
    /**
     * The room uid
     * @type {string}
     */
    this.roomId = roomId;
    /**
     * The message
     * @type {string}
     */
    this.text = values.text;
    /**
     * The message sender
     * @type {string}
     */
    this.from = values.from;
    /**
     * Joined date
     * @type {number}
     */
    this._created = values._created;
  }

  /**
   * Edit the text message. Only the sender or moderator/owner of the room can edit a message.
   * @param {string} newText The new message
   * @returns {Promise<Message>}
   */
  edit(newText) {
    return DataSync.update(`/rooms/${this.roomId}/messages/${this.uid}`, { text: newText })
      .then(() => {
        this.text = newText;
        return this;
      })
      .catch(Log.r('Message~edit'));
  }

  /**
   * Remove the text message. Only the sender or moderator/owner of the room can remove a message.
   * @returns {Promise}
   */
  remove() {
    return DataSync.remove(`/rooms/${this.roomId}/messages/${this.uid}`)
      .catch(Log.r('Message~remove'));
  }

  /**
   *
   * @param {Room} room The room to send the message to
   * @param {string} text The message
   * @return {Promise<Message>}
   */
  static send(room, text) {
    if (!cache.user) {
      return Promise.reject(
        new Error('Cannot send a message to the Room without a User being logged in.')
      );
    }
    const data = {
      from: cache.user.uid,
      _created: DataSync.ts(),
      text
    };
    return DataSync.push(`_/rooms/${room.uid}/messages`, data)
      .then(pushRef => DataSync.get(`_/rooms/${room.uid}/messages/${pushRef.name()}`))
      .then(snapData => new Message(snapData, room.uid))
      .catch(Log.r('Message#send'));
  }
}
