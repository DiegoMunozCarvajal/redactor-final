# Chapter 5: Formatting Output and Speaking for Claude

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

# New argument added for prefill text, with a default value of an empty string
def get_completion(prompt: str, system_prompt="", prefill=""):
    message = client.messages.create(
        model=MODEL_NAME,
        max_tokens=2000,
        temperature=0.0,
        system=system_prompt,
        messages=[
          {"role": "user", "content": prompt},
          {"role": "assistant", "content": prefill}
        ]
    )
    return message.content[0].text
```

---

## Lesson

**Claude can format its output in a wide variety of ways**. You just need to ask for it to do so!

One of these ways is by using XML tags to separate out the response from any other superfluous text. You've already learned that you can use XML tags to make your prompt clearer and more parseable to Claude. It turns out, you can also ask Claude to **use XML tags to make its output clearer and more easily understandable** to humans.

### Examples

Remember the 'poem preamble problem' we solved in Chapter 2 by asking Claude to skip the preamble entirely? It turns out we can also achieve a similar outcome by **telling Claude to put the poem in XML tags**.

```python
# Variable content
ANIMAL = "Rabbit"

# Prompt template with a placeholder for the variable content
PROMPT = f"Please write a haiku about {ANIMAL}. Put it in <haiku> tags."

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print(PROMPT)
print("\n------------------------------------- Claude's response -------------------------------------")
print(get_completion(PROMPT))
```

Why is this something we'd want to do? Well, having the output in **XML tags allows the end user to reliably get the poem and only the poem by writing a short program to extract the content between XML tags**.

An extension of this technique is to **put the first XML tag in the `assistant` turn. When you put text in the `assistant` turn, you're basically telling Claude that Claude has already said something, and that it should continue from that point onward. This technique is called "speaking for Claude" or "prefilling Claude's response."

Below, we've done this with the first `<haiku>` XML tag. Notice how Claude continues directly from where we left off.

```python
# Variable content
ANIMAL = "Cat"

# Prompt template with a placeholder for the variable content
PROMPT = f"Please write a haiku about {ANIMAL}. Put it in <haiku> tags."

# Prefill for Claude's response
PREFILL = "<haiku>"

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print("USER TURN:")
print(PROMPT)
print("\nASSISTANT TURN:")
print(PREFILL)
print("\n------------------------------------- Claude's response -------------------------------------")
print(get_completion(PROMPT, prefill=PREFILL))
```

Claude also excels at using other output formatting styles, notably `JSON`. If you want to enforce JSON output (not deterministically, but close to it), you can also prefill Claude's response with the opening bracket, `{`}.

```python
# Variable content
ANIMAL = "Cat"

# Prompt template with a placeholder for the variable content
PROMPT = f"Please write a haiku about {ANIMAL}. Use JSON format with the keys as \"first_line\", \"second_line\", and \"third_line\"."

# Prefill for Claude's response
PREFILL = "{"

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print("USER TURN")
print(PROMPT)
print("\nASSISTANT TURN")
print(PREFILL)
print("\n------------------------------------- Claude's response -------------------------------------")
print(get_completion(PROMPT, prefill=PREFILL))
```

Below is an example of **multiple input variables in the same prompt AND output formatting specification, all done using XML tags**.

```python
# First input variable
EMAIL = "Hi Zack, just pinging you for a quick update on that prompt you were supposed to write."

# Second input variable
ADJECTIVE = "olde english"

# Prompt template with a placeholder for the variable content
PROMPT = f"Hey Claude. Here is an email: <email>{EMAIL}</email>. Make this email more {ADJECTIVE}. Write the new version in <{ADJECTIVE}_email> XML tags."

# Prefill for Claude's response (now as an f-string with a variable)
PREFILL = f"<{ADJECTIVE}_email>"

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print("USER TURN")
print(PROMPT)
print("\nASSISTANT TURN")
print(PREFILL)
print("\n------------------------------------- Claude's response -------------------------------------")
print(get_completion(PROMPT, prefill=PREFILL))
```

#### Bonus lesson

If you are calling Claude through the API, you can pass the closing XML tag to the `stop_sequences` parameter to get Claude to stop sampling once it emits your desired tag. This can save money and time-to-last-token by eliminating Claude's concluding remarks after it's already given you the answer you care about.

If you would like to experiment with the lesson prompts without changing any content above, scroll all the way to the bottom of the lesson notebook to visit the [**Example Playground**](#example-playground).

---

## Exercises
- [Exercise 5.1 - Steph Curry GOAT](#exercise-51---steph-curry-goat)
- [Exercise 5.2 - Two Haikus](#exercise-52---two-haikus)
- [Exercise 5.3 - Two Haikus, Two Animals](#exercise-53---two-haikus-two-animals)

### Exercise 5.1 - Steph Curry GOAT
Forced to make a choice, Claude designates Michael Jordan as the best basketball player of all time. Can we get Claude to pick someone else?

Change the `PREFILL` variable to **compell Claude to make a detailed argument that the best basketball player of all time is Stephen Curry**. Try not to change anything except `PREFILL` as that is the focus of this exercise.

```python
# Prompt template with a placeholder for the variable content
PROMPT = f"Who is the best basketball player of all time? Please choose one specific player."

# Prefill for Claude's response
PREFILL = ""

# Get Claude's response
response = get_completion(PROMPT, prefill=PREFILL)

# Function to grade exercise correctness
def grade_exercise(text):
    return bool(re.search("Warrior", text))

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print("USER TURN")
print(PROMPT)
print("\nASSISTANT TURN")
print(PREFILL)
print("\n------------------------------------- Claude's response -------------------------------------")
print(response)
print("\n------------------------------------------ GRADING ------------------------------------------")
print("This exercise has been correctly solved:", grade_exercise(response))
```

❓ If you want a hint, run the cell below!

```python
from hints import exercise_5_1_hint; print(exercise_5_1_hint)
```

### Exercise 5.2 - Two Haikus
Modify the `PROMPT` below using XML tags so that Claude writes two haikus about the animal instead of just one. It should be clear where one poem ends and the other begins.

```python
# Variable content
ANIMAL = "cats"

# Prompt template with a placeholder for the variable content
PROMPT = f"Please write a haiku about {ANIMAL}. Put it in <haiku> tags."

# Prefill for Claude's response
PREFILL = "<haiku>"

# Get Claude's response
response = get_completion(PROMPT, prefill=PREFILL)

# Function to grade exercise correctness
def grade_exercise(text):
    return bool(
        (re.search("cat", text.lower()) and re.search("<haiku>", text))
        and (text.count("\n") + 1) > 5
    )

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print("USER TURN")
print(PROMPT)
print("\nASSISTANT TURN")
print(PREFILL)
print("\n------------------------------------- Claude's response -------------------------------------")
print(response)
print("\n------------------------------------------ GRADING ------------------------------------------")
print("This exercise has been correctly solved:", grade_exercise(response))
```

❓ If you want a hint, run the cell below!

```python
from hints import exercise_5_2_hint; print(exercise_5_2_hint)
```

### Exercise 5.3 - Two Haikus, Two Animals
Modify the `PROMPT` below so that **Claude produces two haikus about two different animals**. Use `{ANIMAL1}` as a stand-in for the first substitution, and `{ANIMAL2}` as a stand-in for the second substitution.

```python
# First input variable
ANIMAL1 = "Cat"

# Second input variable
ANIMAL2 = "Dog"

# Prompt template with a placeholder for the variable content
PROMPT = f"Please write a haiku about {ANIMAL1}. Put it in <haiku> tags."

# Get Claude's response
response = get_completion(PROMPT)

# Function to grade exercise correctness
def grade_exercise(text):
    return bool(re.search("tail", text.lower()) and re.search("cat", text.lower()) and re.search("<haiku>", text))

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print("USER TURN")
print(PROMPT)
print("\n------------------------------------- Claude's response -------------------------------------")
print(response)
print("\n------------------------------------------ GRADING ------------------------------------------")
print("This exercise has been correctly solved:", grade_exercise(response))
```

❓ If you want a hint, run the cell below!

```python
from hints import exercise_5_3_hint; print(exercise_5_3_hint)
```

### Congrats!

If you've solved all exercises up until this point, you're ready to move to the next chapter. Happy prompting!

---

## Example Playground

This is an area for you to experiment freely with the prompt examples shown in this lesson and tweak prompts to see how it may affect Claude's responses.

```python
# Variable content
ANIMAL = "Rabbit"

# Prompt template with a placeholder for the variable content
PROMPT = f"Please write a haiku about {ANIMAL}. Put it in <haiku> tags."

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print(PROMPT)
print("\n------------------------------------- Claude's response -------------------------------------")
print(get_completion(PROMPT))
```

```python
# Variable content
ANIMAL = "Cat"

# Prompt template with a placeholder for the variable content
PROMPT = f"Please write a haiku about {ANIMAL}. Put it in <haiku> tags."

# Prefill for Claude's response
PREFILL = "<haiku>"

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print("USER TURN:")
print(PROMPT)
print("\nASSISTANT TURN:")
print(PREFILL)
print("\n------------------------------------- Claude's response -------------------------------------")
print(get_completion(PROMPT, prefill=PREFILL))
```

```python
# Variable content
ANIMAL = "Cat"

# Prompt template with a placeholder for the variable content
PROMPT = f"Please write a haiku about {ANIMAL}. Use JSON format with the keys as \"first_line\", \"second_line\", and \"third_line\"."

# Prefill for Claude's response
PREFILL = "{"

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print("USER TURN")
print(PROMPT)
print("\nASSISTANT TURN")
print(PREFILL)
print("\n------------------------------------- Claude's response -------------------------------------")
print(get_completion(PROMPT, prefill=PREFILL))
```

```python
# First input variable
EMAIL = "Hi Zack, just pinging you for a quick update on that prompt you were supposed to write."

# Second input variable
ADJECTIVE = "olde english"

# Prompt template with a placeholder for the variable content
PROMPT = f"Hey Claude. Here is an email: <email>{EMAIL}</email>. Make this email more {ADJECTIVE}. Write the new version in <{ADJECTIVE}_email> XML tags."

# Prefill for Claude's response (now as an f-string with a variable)
PREFILL = f"<{ADJECTIVE}_email>"

# Print Claude's response
print("--------------------------- Full prompt with variable substutions ---------------------------")
print("USER TURN")
print(PROMPT)
print("\nASSISTANT TURN")
print(PREFILL)
print("\n------------------------------------- Claude's response -------------------------------------")
print(get_completion(PROMPT, prefill=PREFILL))
```
