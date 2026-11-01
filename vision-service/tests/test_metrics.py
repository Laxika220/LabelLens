from eval import metrics

TRUTH = "INGREDIENTS: Wheat Flour (Maida), Sugar, Raising Agents [503(ii), 500(ii)], Salt. CONTAINS: WHEAT, MILK."


def test_perfect_prediction():
    s = metrics.score(TRUTH, TRUTH, ["wheat flour"])
    assert s["cer"] == 0 and s["wer"] == 0
    assert s["ing_recall"] == 1 and s["exact_list"]
    assert s["allergen_recall"] == 1


def test_case_and_spacing_are_ignored():
    pred = "ingredients:  wheat flour (maida),sugar, raising agents [503 (ii), 500(ii)], salt. contains: wheat, milk."
    assert metrics.ingredient_scores(pred, TRUTH)["recall"] == 1


def test_one_character_error_costs_one_ingredient():
    pred = TRUTH.replace("Sugar", "Sugor")
    s = metrics.score(pred, TRUTH, [])
    assert 0 < s["cer"] < 0.02
    assert s["ing_recall"] == 0.75
    assert s["missed"] == ["sugar"]


def test_missed_allergen_term():
    pred = TRUTH.replace("Wheat Flour", "Whe@t Flour")
    assert metrics.allergen_recall(pred, ["wheat flour"]) == 0


def test_statements_are_not_ingredients():
    assert metrics.ingredients(TRUTH) == ["wheat flour(maida)", "sugar", "raising agents[503(ii),500(ii)]", "salt"]


def test_levenshtein():
    assert metrics.levenshtein("kitten", "sitting") == 3
    assert metrics.levenshtein(["a", "b"], ["a", "c", "b"]) == 1
