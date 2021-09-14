"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryMessages = exports.pollMessages = void 0;
const logger_1 = require("../../../utils/logger");
const sleep_1 = require("../../../utils/sleep");
async function pollMessages({ aws, queueUrl, progressCallback, visibilityTimeout, }) {
    const messages = [];
    const promises = [];
    /**
     * Poll in parallel to hit multiple SQS servers at once
     * See https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html
     * and https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html
     * (a single request might not return all messages)
     */
    for (let i = 0; i < 3; i++) {
        promises.push(pollMoreMessages(aws, queueUrl, messages, visibilityTimeout).then(() => {
            if (progressCallback && messages.length > 0) {
                progressCallback(messages.length);
            }
        }));
        await (0, sleep_1.sleep)(200);
    }
    await Promise.all(promises);
    return messages;
}
exports.pollMessages = pollMessages;
async function pollMoreMessages(aws, queueUrl, messages, visibilityTimeout) {
    var _a;
    const messagesResponse = await aws.request("SQS", "receiveMessage", {
        QueueUrl: queueUrl,
        // 10 is the maximum
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 3,
        // By default only hide messages for 1 second to avoid disrupting the queue too much
        VisibilityTimeout: visibilityTimeout !== null && visibilityTimeout !== void 0 ? visibilityTimeout : 1,
    });
    for (const newMessage of (_a = messagesResponse.Messages) !== null && _a !== void 0 ? _a : []) {
        const alreadyInTheList = messages.some((message) => {
            return message.MessageId === newMessage.MessageId;
        });
        if (!alreadyInTheList) {
            messages.push(newMessage);
        }
    }
}
async function retryMessages(aws, queueUrl, dlqUrl, messages) {
    if (messages.length === 0) {
        return {
            numberOfMessagesRetried: 0,
            numberOfMessagesNotRetried: 0,
            numberOfMessagesRetriedButNotDeleted: 0,
        };
    }
    const sendResult = await aws.request("SQS", "sendMessageBatch", {
        QueueUrl: queueUrl,
        Entries: messages.map((message) => {
            if (message.MessageId === undefined) {
                throw new Error(`Found a message with no ID`);
            }
            return {
                Id: message.MessageId,
                MessageAttributes: message.MessageAttributes,
                MessageBody: message.Body,
            };
        }),
    });
    const messagesToDelete = messages.filter((message) => {
        const isMessageInFailedList = sendResult.Failed.some((failedMessage) => message.MessageId === failedMessage.Id);
        return !isMessageInFailedList;
    });
    const deletionResult = await aws.request("SQS", "deleteMessageBatch", {
        QueueUrl: dlqUrl,
        Entries: messagesToDelete.map((message) => {
            return {
                Id: message.MessageId,
                ReceiptHandle: message.ReceiptHandle,
            };
        }),
    });
    if (deletionResult.Failed.length > 0) {
        (0, logger_1.log)(`${deletionResult.Failed.length} failed messages were not successfully deleted from the dead letter queue. These messages will be retried in the main queue, but they will also still be present in the dead letter queue.`);
    }
    return {
        numberOfMessagesRetried: deletionResult.Successful.length,
        numberOfMessagesNotRetried: sendResult.Failed.length,
        numberOfMessagesRetriedButNotDeleted: deletionResult.Failed.length,
    };
}
exports.retryMessages = retryMessages;
//# sourceMappingURL=sqs.js.map