import argparse
import os
import sys
import json
import subprocess
from openai import OpenAI

API_KEY = os.getenv("OPENROUTER_API_KEY")
BASE_URL = os.getenv("OPENROUTER_BASE_URL", default="https://openrouter.ai/api/v1")
MODEL = os.getenv("OPENROUTER_MODEL", default="anthropic/claude-haiku-4.5")
TOOLS= [{
        "type": "function",
        "function": {
            "name": "Read",
            "description": "Read and return the contents of a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "The path to the file to read"
                        }
                },
                "required": ["file_path"]
                }
        }
        },
        {
        "type": "function",
        "function": {
            "name": "Write",
            "description": "Write content to a file",
            "parameters": {
            "type": "object",
            "required": ["file_path", "content"],
            "properties": {
                "file_path": {
                "type": "string",
                "description": "The path of the file to write to"
                },
                "content": {
                "type": "string",
                "description": "The content to write to the file"
                }
            }
            }
        }
        },
        {
        "type": "function",
        "function": {
            "name": "Bash",
            "description": "Execute a shell command",
            "parameters": {
            "type": "object",
            "required": ["command"],
            "properties": {
                "command": {
                "type": "string",
                "description": "The command to execute"
                }
            }
            }
        }
        }]

def main():
    p = argparse.ArgumentParser()
    p.add_argument("-p", required=True)
    args = p.parse_args()

    if not API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is not set")

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

    user_message = {"role": "user", "content": args.p}

    messages= [user_message]

    finished = False

    round = 0
    total_input_tokens = 0
    total_output_tokens = 0
    read_messages = 0
    previous_prompt_tokens = 0

    while not finished:
        
        round += 1
        print(f"Round n. {round}", file=sys.stderr)
        

        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools= TOOLS
            )

        if not response.choices or len(response.choices) == 0:
            raise RuntimeError("no choices in response")
     
        
        msg = response.choices[0].message
        
        print(f"Previous token sum: {previous_prompt_tokens}", file=sys.stderr)
        
        input_tokens = response.usage.prompt_tokens
        
        for m in messages[read_messages:]:
            print(json.dumps(m, indent=2, ensure_ascii=False), file=sys.stderr)
        
        print(f"Input token cost: {input_tokens - previous_prompt_tokens}", file=sys.stderr)
        
        previous_prompt_tokens = input_tokens 
        
        read_messages = len(messages)
                        
        total_input_tokens += input_tokens
        
        output_tokens = response.usage.completion_tokens
        total_output_tokens += output_tokens
        
        print(f"Appended {len(messages) - 1} previous messages.", file=sys.stderr)
        print(f"Round n.{round} Input Tokens: {input_tokens} | Total input tokens: {total_input_tokens}", file=sys.stderr)


        messages.append(msg.model_dump(exclude_none=True))
        
        for m in messages[read_messages:]:
            print(json.dumps(m, indent=2, ensure_ascii=False), file=sys.stderr)

        print(f"Round n.{round} Output Tokens: {output_tokens} | Total output tokens: {total_output_tokens}", file=sys.stderr)
        print("___________________________________", file=sys.stderr)
                    
        read_messages = len(messages)
        
        tool_calls = msg.tool_calls

        if tool_calls:
            for tool_call in tool_calls:

                tool_call_id = tool_call.id
                tool_name = tool_call.function.name

                # print(tool_name, file=sys.stderr)

                json_arguments = tool_call.function.arguments

                parameters = json.loads(json_arguments)


                if  tool_name == "Read":

                    file_path = parameters["file_path"]

                    with open(file_path, "r", encoding="utf-8") as f:
                        file_content = f.read()

                    messages.append({"role": "tool", "content": file_content, "tool_call_id": tool_call_id })

                elif tool_name == "Write":

                    file_path = parameters["file_path"]

                    content = parameters["content"]

                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(content)
                        result = f"Successfully wrote to {file_path}"
                                           

                    messages.append({"role": "tool", "content": result, "tool_call_id": tool_call_id })

                elif tool_name == "Bash":

                    command = parameters["command"]

                    result = subprocess.run(command, capture_output=True, shell=True, text=True )

                    # print(result)
                    # print(type(result), type(result.stdout))
                    # print(repr(result.stdout))
                    # print(repr(result.stderr))
                    # print(result.returncode)

                    complete_result = result.stdout + result.stderr

                    # print(result)

                    messages.append({"role": "tool", "content": complete_result, "tool_call_id": tool_call_id })


                else:
                    raise RuntimeError("no such tool!")

        else:
            print(msg.content)
            finished = True
        
        


if __name__ == "__main__":
    main()
