# Tutorial How-To

This tutorial **requires an API key** for interaction. If you don't have an API key, you can sign up for one via the [Anthropic Console](https://console.anthropic.com/) or view our [static tutorial answer key](https://docs.google.com/spreadsheets/u/0/d/1jIxjzUWG-6xBVIa2ay6yDpLyeuOh_hR_ZB75a47KX_E/edit) instead.

## How to get started

1. Clone this repository to your local machine.

2. Install the required dependencies by running the following command:

```python
!pip install anthropic
```

3. Set up your API key and model name. Replace `"your_api_key_here"` with your actual Anthropic API key.

```python
API_KEY = "your_api_key_here"
MODEL_NAME = "claude-3-haiku-20240307"

# Stores the API_KEY & MODEL_NAME variables for use across notebooks within the IPython store
%store API_KEY
%store MODEL_NAME
```

4. Run the notebook cells in order, following the instructions provided.

---

## Usage Notes & Tips 💡

- This course uses Claude 3 Haiku with temperature 0. We will talk more about temperature later in the course. For now, it's enough to understand that these settings yield more deterministic results. All prompt engineering techniques in this course also apply to previous generation legacy Claude models such as Claude 2 and Claude Instant 1.2.

- You can use `Shift + Enter` to execute the cell and move to the next one.

- When you reach the bottom of a tutorial page, navigate to the next numbered file in the folder, or to the next numbered folder if you're finished with the content within that chapter file.

### The Anthropic SDK & the Messages API
We will be using the [Anthropic python SDK](https://docs.anthropic.com/claude/reference/client-sdks) and the [Messages API](https://docs.anthropic.com/claude/reference/messages_post) throughout this tutorial. 

Below is an example of what running a prompt will look like in this tutorial. First, we create `get_completion`, which is a helper function that sends a prompt to Claude and returns Claude's generated response. Run that cell now.

```python
import anthropic

client = anthropic.Anthropic(api_key=API_KEY)

def get_completion(prompt: str):
    message = client.messages.create(
        model=MODEL_NAME,
        max_tokens=2000,
        temperature=0.0,
        messages=[
          {"role": "user", "content": prompt}
        ]
    )
    return message.content[0].text
```

Now we will write out an example prompt for Claude and print Claude's output by running our `get_completion` helper function. Running the cell below will print out a response from Claude beneath it.

Feel free to play around with the prompt string to elicit different responses from Claude.

```python
# Prompt
prompt = "Hello, Claude!"

# Get Claude's response
print(get_completion(prompt))
```

The `API_KEY` and `MODEL_NAME` variables defined earlier will be used throughout the tutorial. Just make sure to run the cells for each tutorial page from top to bottom.
