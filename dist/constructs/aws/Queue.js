"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Queue = void 0;
const tslib_1 = require("tslib");
const aws_sqs_1 = require("@aws-cdk/aws-sqs");
const aws_cloudwatch_1 = require("@aws-cdk/aws-cloudwatch");
const aws_sns_1 = require("@aws-cdk/aws-sns");
const core_1 = require("@aws-cdk/core");
const chalk_1 = (0, tslib_1.__importDefault)(require("chalk"));
const ora_1 = (0, tslib_1.__importDefault)(require("ora"));
const child_process_1 = require("child_process");
const inquirer = (0, tslib_1.__importStar)(require("inquirer"));
const abstracts_1 = require("@lift/constructs/abstracts");
const sqs_1 = require("./queue/sqs");
const sleep_1 = require("../../utils/sleep");
const CloudFormation_1 = require("../../CloudFormation");
const QUEUE_DEFINITION = {
    type: "object",
    properties: {
        type: { const: "queue" },
        worker: {
            type: "object",
            properties: {
                handler: { type: "string" },
                timeout: { type: "number" },
            },
            required: ["handler"],
            additionalProperties: true,
        },
        maxRetries: { type: "number" },
        alarm: { type: "string" },
        batchSize: {
            type: "number",
            minimum: 1,
            maximum: 10,
        },
    },
    additionalProperties: false,
    required: ["worker"],
};
class Queue extends abstracts_1.AwsConstruct {
    constructor(scope, id, configuration, provider) {
        var _a, _b;
        super(scope, id);
        this.id = id;
        this.configuration = configuration;
        this.provider = provider;
        // The default function timeout is 6 seconds in the Serverless Framework
        const functionTimeout = (_a = configuration.worker.timeout) !== null && _a !== void 0 ? _a : 6;
        const maxRetries = (_b = configuration.maxRetries) !== null && _b !== void 0 ? _b : 3;
        const dlq = new aws_sqs_1.Queue(this, "Dlq", {
            queueName: `${this.provider.stackName}-${id}-dlq`,
            // 14 days is the maximum, we want to keep these messages for as long as possible
            retentionPeriod: core_1.Duration.days(14),
        });
        this.queue = new aws_sqs_1.Queue(this, "Queue", {
            queueName: `${this.provider.stackName}-${id}`,
            // This should be 6 times the lambda function's timeout
            // See https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
            visibilityTimeout: core_1.Duration.seconds(functionTimeout * 6),
            deadLetterQueue: {
                maxReceiveCount: maxRetries,
                queue: dlq,
            },
        });
        const alarmEmail = configuration.alarm;
        if (alarmEmail !== undefined) {
            const alarmTopic = new aws_sns_1.Topic(this, "AlarmTopic", {
                topicName: `${this.provider.stackName}-${id}-dlq-alarm-topic`,
                displayName: `[Alert][${id}] There are failed jobs in the dead letter queue.`,
            });
            new aws_sns_1.Subscription(this, "AlarmTopicSubscription", {
                topic: alarmTopic,
                protocol: aws_sns_1.SubscriptionProtocol.EMAIL,
                endpoint: alarmEmail,
            });
            const alarm = new aws_cloudwatch_1.Alarm(this, "Alarm", {
                alarmName: `${this.provider.stackName}-${id}-dlq-alarm`,
                alarmDescription: "Alert triggered when there are failed jobs in the dead letter queue.",
                metric: new aws_cloudwatch_1.Metric({
                    namespace: "AWS/SQS",
                    metricName: "ApproximateNumberOfMessagesVisible",
                    dimensions: {
                        QueueName: dlq.queueName,
                    },
                    statistic: "Sum",
                    period: core_1.Duration.minutes(1),
                }),
                evaluationPeriods: 1,
                // Alert as soon as we have 1 message in the DLQ
                threshold: 0,
                comparisonOperator: aws_cloudwatch_1.ComparisonOperator.GREATER_THAN_THRESHOLD,
            });
            alarm.addAlarmAction({
                bind() {
                    return { alarmActionArn: alarmTopic.topicArn };
                },
            });
        }
        // CloudFormation outputs
        this.queueArnOutput = new core_1.CfnOutput(this, "QueueArn", {
            description: `ARN of the "${id}" SQS queue.`,
            value: this.queue.queueArn,
        });
        this.queueUrlOutput = new core_1.CfnOutput(this, "QueueUrl", {
            description: `URL of the "${id}" SQS queue.`,
            value: this.queue.queueUrl,
        });
        this.dlqUrlOutput = new core_1.CfnOutput(this, "DlqUrl", {
            description: `URL of the "${id}" SQS dead letter queue.`,
            value: dlq.queueUrl,
        });
        this.appendFunctions();
    }
    outputs() {
        return {
            queueUrl: () => this.getQueueUrl(),
        };
    }
    variables() {
        return {
            queueUrl: this.queue.queueUrl,
            queueArn: this.queue.queueArn,
        };
    }
    permissions() {
        return [new CloudFormation_1.PolicyStatement("sqs:SendMessage", [this.queue.queueArn])];
    }
    appendFunctions() {
        var _a;
        // The default batch size is 1
        const batchSize = (_a = this.configuration.batchSize) !== null && _a !== void 0 ? _a : 1;
        // Override events for the worker
        this.configuration.worker.events = [
            // Subscribe the worker to the SQS queue
            {
                sqs: {
                    arn: this.queue.queueArn,
                    batchSize: batchSize,
                    // TODO add setting
                    maximumBatchingWindow: 60,
                },
            },
        ];
        this.provider.addFunction(`${this.id}Worker`, this.configuration.worker);
    }
    async getQueueUrl() {
        return this.provider.getStackOutput(this.queueUrlOutput);
    }
    async getDlqUrl() {
        return this.provider.getStackOutput(this.dlqUrlOutput);
    }
    async listDlq() {
        var _a, _b;
        const dlqUrl = await this.getDlqUrl();
        if (dlqUrl === undefined) {
            console.log(chalk_1.default.red('Could not find the dead letter queue in the deployed stack. Try running "serverless deploy" first?'));
            return;
        }
        const progress = (0, ora_1.default)("Polling failed messages from the dead letter queue").start();
        const messages = await (0, sqs_1.pollMessages)({
            aws: this.provider,
            queueUrl: dlqUrl,
            progressCallback: (numberOfMessagesFound) => {
                progress.text = `Polling failed messages from the dead letter queue (${numberOfMessagesFound} found)`;
            },
        });
        if (messages.length === 0) {
            progress.stopAndPersist({
                symbol: "👌",
                text: "No failed messages found in the dead letter queue",
            });
            return;
        }
        progress.warn(`${messages.length} messages found in the dead letter queue:`);
        for (const message of messages) {
            console.log(chalk_1.default.yellow(`Message #${(_a = message.MessageId) !== null && _a !== void 0 ? _a : "?"}`));
            console.log(this.formatMessageBody((_b = message.Body) !== null && _b !== void 0 ? _b : ""));
            console.log();
        }
        const retryCommand = chalk_1.default.bold(`serverless ${this.id}:failed:retry`);
        const purgeCommand = chalk_1.default.bold(`serverless ${this.id}:failed:purge`);
        console.log(`Run ${retryCommand} to retry all messages, or ${purgeCommand} to delete those messages forever.`);
    }
    async purgeDlq() {
        const dlqUrl = await this.getDlqUrl();
        if (dlqUrl === undefined) {
            console.log(chalk_1.default.red('Could not find the dead letter queue in the deployed stack. Try running "serverless deploy" first?'));
            return;
        }
        const progress = (0, ora_1.default)("Purging the dead letter queue of failed messages").start();
        await this.provider.request("SQS", "purgeQueue", {
            QueueUrl: dlqUrl,
        });
        /**
         * Sometimes messages are still returned after the purge is issued.
         * For a less confusing experience, we wait 500ms so that if the user re-runs `sls queue:failed` there
         * are less chances that deleted messages show up again.
         */
        await (0, sleep_1.sleep)(500);
        progress.succeed("The dead letter queue has been purged, failed messages are gone 🙈");
    }
    async retryDlq() {
        const queueUrl = await this.getQueueUrl();
        const dlqUrl = await this.getDlqUrl();
        if (queueUrl === undefined || dlqUrl === undefined) {
            console.log(chalk_1.default.red('Could not find the queue in the deployed stack. Try running "serverless deploy" first?'));
            return;
        }
        const progress = (0, ora_1.default)("Moving failed messages from DLQ to the main queue to be retried").start();
        let shouldContinue = true;
        let totalMessagesToRetry = 0;
        let totalMessagesRetried = 0;
        do {
            const messages = await (0, sqs_1.pollMessages)({
                aws: this.provider,
                queueUrl: dlqUrl,
                /**
                 * Since we intend on deleting the messages, we'll reserve them for 10 seconds
                 * That avoids having those message reappear in the `do` loop, because SQS sometimes
                 * takes a while to actually delete messages.
                 */
                visibilityTimeout: 10,
            });
            totalMessagesToRetry += messages.length;
            progress.text = `Moving failed messages from DLQ to the main queue to be retried (${totalMessagesRetried}/${totalMessagesToRetry})`;
            const result = await (0, sqs_1.retryMessages)(this.provider, queueUrl, dlqUrl, messages);
            totalMessagesRetried += result.numberOfMessagesRetried;
            progress.text = `Moving failed messages from DLQ to the main queue to be retried (${totalMessagesRetried}/${totalMessagesToRetry})`;
            // Stop if we have any failure (that simplifies the flow for now)
            if (result.numberOfMessagesRetriedButNotDeleted > 0 || result.numberOfMessagesNotRetried > 0) {
                progress.fail(`There were some errors:`);
                if (totalMessagesRetried > 0) {
                    console.log(`${totalMessagesRetried} failed messages have been successfully moved to the main queue to be retried.`);
                }
                if (result.numberOfMessagesNotRetried > 0) {
                    console.log(`${result.numberOfMessagesNotRetried} failed messages could not be retried (for some unknown reason SQS refused to move them). These messages are still in the dead letter queue. Maybe try again?`);
                }
                if (result.numberOfMessagesRetriedButNotDeleted > 0) {
                    console.log(`${result.numberOfMessagesRetriedButNotDeleted} failed messages were moved to the main queue, but were not successfully deleted from the dead letter queue. That means that these messages will be retried in the main queue, but they will also still be present in the dead letter queue.`);
                }
                console.log("Stopping now because of the error above. Not all messages have been retried, run the command again to continue.");
                return;
            }
            shouldContinue = result.numberOfMessagesRetried > 0;
        } while (shouldContinue);
        if (totalMessagesToRetry === 0) {
            progress.stopAndPersist({
                symbol: "👌",
                text: "No failed messages found in the dead letter queue",
            });
            return;
        }
        progress.succeed(`${totalMessagesRetried} failed message(s) moved to the main queue to be retried 💪`);
    }
    async sendMessage(options) {
        const queueUrl = await this.getQueueUrl();
        if (queueUrl === undefined) {
            console.log(chalk_1.default.red("Could not find the queue in the deployed stack. Try running 'serverless deploy' first?"));
            return;
        }
        const body = typeof options.body === "string" ? options.body : await this.askMessageBody();
        await this.provider.request("SQS", "sendMessage", {
            QueueUrl: queueUrl,
            MessageBody: body,
        });
    }
    displayLogs(options) {
        const args = ["logs", "--function", `${this.id}Worker`];
        for (const [option, value] of Object.entries(options)) {
            args.push(option.length === 1 ? `-${option}` : `--${option}`);
            if (typeof value === "string") {
                args.push(value);
            }
        }
        console.log(chalk_1.default.gray(`serverless ${args.join(" ")}`));
        args.unshift(process.argv[1]);
        (0, child_process_1.spawnSync)(process.argv[0], args, {
            cwd: process.cwd(),
            stdio: "inherit",
        });
    }
    formatMessageBody(body) {
        try {
            // If it's valid JSON, we'll format it nicely
            const data = JSON.parse(body);
            return JSON.stringify(data, null, 2);
        }
        catch (e) {
            // If it's not valid JSON, we'll print the body as-is
            return body;
        }
    }
    async askMessageBody() {
        const responses = await inquirer.prompt({
            message: "What is the body of the SQS message to send (can be JSON or any string)",
            type: "editor",
            name: "body",
            validate: (input) => {
                return input.length > 0 ? true : "The message body cannot be empty";
            },
        });
        return responses.body.trim();
    }
}
exports.Queue = Queue;
Queue.type = "queue";
Queue.schema = QUEUE_DEFINITION;
Queue.commands = {
    logs: {
        usage: "Output the logs of the queue's worker function",
        handler: Queue.prototype.displayLogs,
        options: {
            tail: {
                usage: "Tail the log output",
                shortcut: "t",
                type: "boolean",
            },
            startTime: {
                usage: "Logs before this time will not be displayed. Default: `10m` (last 10 minutes logs only)",
                type: "string",
            },
            filter: {
                usage: "A filter pattern",
                type: "string",
            },
            interval: {
                usage: "Tail polling interval in milliseconds. Default: `1000`",
                shortcut: "i",
                type: "string",
            },
        },
    },
    send: {
        usage: "Send a new message to the SQS queue",
        handler: Queue.prototype.sendMessage,
        options: {
            body: {
                usage: "Body of the SQS message",
                type: "string",
            },
        },
    },
    failed: {
        usage: "List failed messages from the dead letter queue",
        handler: Queue.prototype.listDlq,
    },
    "failed:purge": {
        usage: "Purge failed messages from the dead letter queue",
        handler: Queue.prototype.purgeDlq,
    },
    "failed:retry": {
        usage: "Retry failed messages from the dead letter queue by moving them to the main queue",
        handler: Queue.prototype.retryDlq,
    },
};
//# sourceMappingURL=Queue.js.map