# Chapter 3: Assigning Roles (Role Prompting)

- [Lesson](#lesson)
- [Exercises](#exercises)
- [Example Playground](#example-playground)

## Setup

Run the following setup cell to load your API key and establish the `get_completion` helper function.

```python
!pip install anthropic

# Import python's built-in regular expression library
import re
import anthropic

# Retrieve the API_KEY & MODEL_NAME variables from the IPython store
%store -r API_KEY
%store -r MODEL_NAME

client = anthropic.Anthropic(api_key=API_KEY)

def get_completion(prompt: str, system_prompt=""):
    message = client.messages.create(
        model=MODEL_NAME,
        max_tokens=2000,
        temperature=0.0,
        system=system_prompt,
        messages=[
          {"role": "user", "content": prompt}
        ]
    )
    return message.content[0].text
```

---

## Lesson

Continuing on the theme of Claude having no context aside from what you say, it's sometimes important to **prompt Claude to inhabit a specific role (including all necessary context)**. This is also known as role prompting. The more detail to the role context, the better.

**Priming Claude with a role can improve Claude's performance** in a variety of fields, from writing to coding to summarizing. It's like how humans can sometimes be helped when told to "think like a ______". Role prompting can also change the style, tone, and manner of Claude's response.

**Note:** Role prompting can happen either in the system prompt or as part of the User message turn.

### Examples

In the example below, we see that without role prompting, Claude provides a **straightforward and non-stylized answer** when asked to give a single sentence perspective on skateboarding.

However, when we prime Claude to inhabit the role of a cat, Claude's perspective changes, and thus **Claude's response tone, style, content adapts to the new role**. 

**Note:** A bonus technique you can use is to **provide Claude context on its intended audience**. Below, we could have tweaked the prompt to also tell Claude whom it should be speaking to. "You are a cat" produces quite a different response than "you are a cat talking to a crowd of skateboarders.

Here is the prompt without role prompting in the system prompt:

```python
# Prompt
PROMPT = "In one sentence, what do you think about skateboarding?"

# Print Claude's response
print(get_completion(PROMPT))
```

Here is the same user question, except with role prompting.

```python
# System prompt
SYSTEM_PROMPT = "You are a cat."

# Prompt
PROMPT = "In one sentence, what do you think about skateboarding?"

# Print Claude's response
print(get_completion(PROMPT, SYSTEM_PROMPT))
```

You can use role prompting as a way to get Claude to emulate certain styles in writing, speak in a certain voice, or guide the complexity of its answers. **Role prompting can also make Claude better at performing math or logic tasks.**

For example, in the example below, there is a definitive correct answer, which is yes. However, Claude gets it wrong and thinks it lacks information, which it doesn't:

```python
# Prompt
PROMPT = "Jack is looking at Anne. Anne is looking at George. Jack is married, George is not, and we don’t know if Anne is married. Is a married person looking at an unmarried person?"

# Print Claude's response
print(get_completion(PROMPT))
```

Now, what if we **prime Claude to act as a logic bot**? How will that change Claude's answer? 

It turns out that with this new role assignment, Claude gets it right. (Although notably not for all the right reasons)

```python
# System prompt
SYSTEM_PROMPT = "You are a logic bot designed to answer complex logic problems."

# Prompt
PROMPT = "Jack is looking at Anne. Anne is looking at George. Jack is married, George is not, and we don’t know if Anne is married. Is a married person looking at an unmarried person?"

# Print Claude's response
print(get_completion(PROMPT, SYSTEM_PROMPT))
```

**Note:** What you'll learn throughout this course is that there are **many prompt engineering techniques you can use to derive similar results**. Which techniques you use is up to you and your preference! We encourage you to **experiment to find your own prompt engineering style**.

If you would like to experiment with the lesson prompts without changing any content above, scroll all the way to the bottom of the lesson notebook to visit the [**Example Playground**](#example-playground).

---

## Exercises
- [Exercise 3.1 - Math Correction](#exercise-31---math-correction)

### Exercise 3.1 - Math Correction
In some instances, **Claude may struggle with mathematics**, even simple mathematics. Below, Claude incorrectly assesses the math problem as correctly solved, even though there's an obvious arithmetic mistake in the second step. Note that Claude actually catches the mistake when going through step-by-step, but doesn't jump to the conclusion that the overall solution is wrong.

Modify the `PROMPT` and / or the `SYSTEM_PROMPT` to make Claude grade the solution as `incorrectly` solved, rather than correctly solved.

```python
# System prompt - if you don't want to use a system prompt, you can leave this variable set to an empty string
SYSTEM_PROMPT = ""

# Prompt
PROMPT = """Is this equation solved correctly below?

2x - 3 = 9
2x = 6
x = 3"""

# Get Claude's response
response = get_completion(PROMPT, SYSTEM_PROMPT)

# Function to grade exercise correctness
def grade_exercise(text):
    if "incorrect" in text or "not correct" in text.lower():
        return True
    else:
        return False

# Print Claude's response and the corresponding grade
print(response)
print("\n--------------------------- GRADING ---------------------------")
print("This exercise has been correctly solved:", grade_exercise(response))
```

❓ If you want a hint, run the cell below!

```python
from hints import exercise_3_1_hint; print(exercise_3_1_hint)
```

### Congrats!

If you've solved all exercises up until this point, you're ready to move to the next chapter. Happy prompting!

---

## Example Playground

This is an area for you to experiment freely with the prompt examples shown in this lesson and tweak prompts to see how it may affect Claude's responses.

```python
# Prompt
PROMPT = "In one sentence, what do you think about skateboarding?"

# Print Claude's response
print(get_completion(PROMPT))
```

```python
# System prompt
SYSTEM_PROMPT = "You are a cat."

# Prompt
PROMPT = "In one sentence, what do you think about skateboarding?"

# Print Claude's response
print(get_completion(PROMPT, SYSTEM_PROMPT))
```

```python
# Prompt
PROMPT = "Jack is looking at Anne. Anne is looking at George. Jack is married, George is not, and we don’t know if Anne is married. Is a married person looking at an unmarried person?"

# Print Claude's response
print(get_completion(PROMPT))
```

```python
# System prompt
SYSTEM_PROMPT = "You are a logic bot designed to answer complex logic problems."

# Prompt
PROMPT = "Jack is looking at Anne. Anne is looking at George. Jack is married, George is not, and we don’t know if Anne is married. Is a married person looking at an unmarried person?"

# Print Claude's response
print(get_completion(PROMPT, SYSTEM_PROMPT))
```
