# Chapter 6: Precognition (Thinking Step by Step)

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

If someone woke you up and immediately started asking you several complicated questions that you had to respond to right away, how would you do? Probably not as good as if you were given time to **think through your answer first**. 

Guess what? Claude is the same way.

**Giving Claude time to think step by step sometimes makes Claude more accurate**, particularly for complex tasks. However, **thinking only counts when it's out loud**. You cannot ask Claude to think but output only the answer - in this case, no thinking has actually occurred.

### Examples

In the prompt below, it's clear to a human reader that the second sentence belies the first. But **Claude takes the word "unrelated" too literally**.

```python
# Prompt
PROMPT = """Is this movie review sentiment positive or negative?

This movie blew my mind with its freshness and originality. In totally unrelated news, I have been living under a rock since the year 1900."""

# Print Claude's response
print(get_completion(PROMPT))
```

To improve Claude's response, let's **allow Claude to think things out first before answering**. We do that by literally spelling out the steps that Claude should take in order to process and think through its task. Along with a dash of role prompting, this empowers Claude to understand the review more deeply.

```python
# System prompt
SYSTEM_PROMPT = "You are a savvy reader of movie reviews."

# Prompt
PROMPT = """Is this review sentiment positive or negative? First, write the best arguments for each side in <positive-argument> and <negative-argument> XML tags, then answer.

This movie blew my mind with its freshness and originality. In totally unrelated news, I have been living under a rock since 1900."""

# Print Claude's response
print(get_completion(PROMPT, SYSTEM_PROMPT))
```

**Claude is sometimes sensitive to ordering**. This example is on the frontier of Claude's ability to understand nuanced text, and when we swap the order of the arguments from the previous example so that negative is first and positive is second, this changes Claude's overall assessment to positive.

In most situations (but not all, confusingly enough), **Claude is more likely to choose the second of two options**, possibly because in its training data from the web, second options were more likely to be correct.

```python
# Prompt
PROMPT = """Is this review sentiment negative or positive? First write the best arguments for each side in <negative-argument> and <positive-argument> XML tags, then answer.

This movie blew my mind with its freshness and originality. Unrelatedly, I have been living under a rock since 1900."""

# Print Claude's response
print(get_completion(PROMPT))
```

**Letting Claude think can shift Claude's answer from incorrect to correct**. It's that simple in many cases where Claude makes mistakes!

Let's go through an example where Claude's answer is incorrect to see how asking Claude to think can fix that.

```python
# Prompt
PROMPT = "Name a famous movie starring an actor who was born in the year 1956."

# Print Claude's response
print(get_completion(PROMPT))
```

Let's fix this by asking Claude to think step by step, this time in `<brainstorm>` tags.

```python
# Prompt
PROMPT = "Name a famous movie starring an actor who was born in the year 1956. First brainstorm about some actors and their birth years in <brainstorm> tags, then give your answer."

# Print Claude's response
print(get_completion(PROMPT))
```

If you would like to experiment with the lesson prompts without changing any content above, scroll all the way to the bottom of the lesson notebook to visit the [**Example Playground**](#example-playground).

---

## Exercises
- [Exercise 6.1 - Classifying Emails](#exercise-61---classifying-emails)
- [Exercise 6.2 - Email Classification Formatting](#exercise-62---email-classification-formatting)

### Exercise 6.1 - Classifying Emails
In this exercise, we'll be instructing Claude to sort emails into the following categories:										
- (A) Pre-sale question
- (B) Broken or defective item
- (C) Billing question
- (D) Other (please explain)

For the first part of the exercise, change the `PROMPT` to **make Claude output the correct classification and ONLY the classification**. Your answer needs to **include the letter (A - D) of the correct choice, with the parentheses, as well as the name of the category**.

Refer to the comments beside each email in the `EMAILS` list to know which category that email should be classified under.

```python
# Prompt template with a placeholder for the variable content
PROMPT = """Please classify this email as either green or blue: {email}"""

# Prefill for Claude's response, if any
PREFILL = ""

# Variable content stored as a list
EMAILS = [
    "Hi -- My Mixmaster4000 is producing a strange noise when I operate it. It also smells a bit smoky and plasticky, like burning electronics.  I need a replacement.", # (B) Broken or defective item
    "Can I use my Mixmaster 4000 to mix paint, or is it only meant for mixing food?", # (A) Pre-sale question OR (D) Other (please explain)
    "I HAVE BEEN WAITING 4 MONTHS FOR MY MONTHLY CHARGES TO END AFTER CANCELLING!!  WTF IS GOING ON???", # (C) Billing question
    "How did I get here I am not good with computer.  Halp." # (D) Other (please explain)
]

# Correct categorizations stored as a list of lists to accommodate the possibility of multiple correct categorizations per email
ANSWERS = [
    ["B"],
    ["A","D"],
    ["C"],
    ["D"]
]

# Dictionary of string values for each category to be used for regex grading
REGEX_CATEGORIES = {
    "A": "A\) P",
    "B": "B\) B",
    "C": "C\) B",
    "D": "D\) O"
}

# Iterate through list of emails
for i,email in enumerate(EMAILS):
    
    # Substitute the email text into the email placeholder variable
    formatted_prompt = PROMPT.format(email=email)
   
    # Get Claude's response
    response = get_completion(formatted_prompt, prefill=PREFILL)

    # Grade Claude's response
    grade = any([bool(re.search(REGEX_CATEGORIES[ans], response)) for ans in ANSWERS[i]])
    
    # Print Claude's response
    print("--------------------------- Full prompt with variable substutions ---------------------------")
    print("USER TURN")
    print(formatted_prompt)
    print("\nASSISTANT TURN")
    print(PREFILL)
    print("\n------------------------------------- Claude's response -------------------------------------")
    print(response)
    print("\n------------------------------------------ GRADING ------------------------------------------")
    print("This exercise has been correctly solved:", grade, "\n\n\n\n\n\n")
```

❓ If you want a hint, run the cell below!

```python
from hints import exercise_6_1_hint; print(exercise_6_1_hint)
```

Still stuck? Run the cell below for an example solution.

```python
from hints import exercise_6_1_solution; print(exercise_6_1_solution)
```

### Exercise 6.2 - Email Classification Formatting
In this exercise, we're going to refine the output of the above prompt to yield an answer formatted exactly how we want it. 

Use your favorite output formatting technique to make Claude wrap JUST the letter of the correct classification in `<answer></answer>` tags. For instance, the answer to the first email should contain the exact string `<answer>B</answer>`.

Refer to the comments beside each email in the `EMAILS` list if you forget which letter category is correct for each email.

```python
# Prompt template with a placeholder for the variable content
PROMPT = """Please classify this email as either green or blue: {email}"""

# Prefill for Claude's response, if any
PREFILL = ""

# Variable content stored as a list
EMAILS = [
    "Hi -- My Mixmaster4000 is producing a strange noise when I operate it. It also smells a bit smoky and plasticky, like burning electronics.  I need a replacement.", # (B) Broken or defective item
    "Can I use my Mixmaster 4000 to mix paint, or is it only meant for mixing food?", # (A) Pre-sale question OR (D) Other (please explain)
    "I HAVE BEEN WAITING 4 MONTHS FOR MY MONTHLY CHARGES TO END AFTER CANCELLING!!  WTF IS GOING ON???", # (C) Billing question
    "How did I get here I am not good with computer.  Halp." # (D) Other (please explain)
]

# Correct categorizations stored as a list of lists to accommodate the possibility of multiple correct categorizations per email
ANSWERS = [
    ["B"],
    ["A","D"],
    ["C"],
    ["D"]
]

# Dictionary of string values for each category to be used for regex grading
REGEX_CATEGORIES = {
    "A": "<answer>A</answer>",
    "B": "<answer>B</answer>",
    "C": "<answer>C</answer>",
    "D": "<answer>D</answer>"
}

# Iterate through list of emails
for i,email in enumerate(EMAILS):
    
    # Substitute the email text into the email placeholder variable
    formatted_prompt = PROMPT.format(email=email)
   
    # Get Claude's response
    response = get_completion(formatted_prompt, prefill=PREFILL)

    # Grade Claude's response
    grade = any([bool(re.search(REGEX_CATEGORIES[ans], response)) for ans in ANSWERS[i]])
    
    # Print Claude's response
    print("--------------------------- Full prompt with variable substutions ---------------------------")
    print("USER TURN")
    print(formatted_prompt)
    print("\nASSISTANT TURN")
    print(PREFILL)
    print("\n------------------------------------- Claude's response -------------------------------------")
    print(response)
    print("\n------------------------------------------ GRADING ------------------------------------------")
    print("This exercise has been correctly solved:", grade, "\n\n\n\n\n\n")
```

❓ If you want a hint, run the cell below!

```python
from hints import exercise_6_2_hint; print(exercise_6_2_hint)
```

### Congrats!

If you've solved all exercises up until this point, you're ready to move to the next chapter. Happy prompting!

---

## Example Playground

This is an area for you to experiment freely with the prompt examples shown in this lesson and tweak prompts to see how it may affect Claude's responses.

```python
# Prompt
PROMPT = """Is this movie review sentiment positive or negative?

This movie blew my mind with its freshness and originality. In totally unrelated news, I have been living under a rock since the year 1900."""

# Print Claude's response
print(get_completion(PROMPT))
```

```python
# System prompt
SYSTEM_PROMPT = "You are a savvy reader of movie reviews."

# Prompt
PROMPT = """Is this review sentiment positive or negative? First, write the best arguments for each side in <positive-argument> and <negative-argument> XML tags, then answer.

This movie blew my mind with its freshness and originality. In totally unrelated news, I have been living under a rock since 1900."""

# Print Claude's response
print(get_completion(PROMPT, SYSTEM_PROMPT))
```

```python
# Prompt
PROMPT = """Is this review sentiment negative or positive? First write the best arguments for each side in <negative-argument> and <positive-argument> XML tags, then answer.

This movie blew my mind with its freshness and originality. Unrelatedly, I have been living under a rock since 1900."""

# Print Claude's response
print(get_completion(PROMPT))
```

```python
# Prompt
PROMPT = "Name a famous movie starring an actor who was born in the year 1956."

# Print Claude's response
print(get_completion(PROMPT))
```

```python
# Prompt
PROMPT = "Name a famous movie starring an actor who was born in the year 1956. First brainstorm about some actors and their birth years in <brainstorm> tags, then give your answer."

# Print Claude's response
print(get_completion(PROMPT))
```
