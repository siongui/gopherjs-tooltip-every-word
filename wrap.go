package wrapwords

import (
	"github.com/gopherjs/gopherjs/js"
	tt "github.com/siongui/gopherjs-tooltip"
	"regexp"
	"strings"
)

var paliWord = regexp.MustCompile(`[AaBbCcDdEeGgHhIiJjKkLlMmNnOoPpRrSsTtUuVvYyĀāĪīŪūṀṁṂṃŊŋṆṇṄṅÑñṬṭḌḍḶḷ]+`)

func markPaliWordInSpan(s string) string {
	return paliWord.ReplaceAllStringFunc(s, func(match string) string {
		return "<span>" + match + "</span>"
	})
}

func toDom(s string) *js.Object {
	// wrap all words in span
	spanContainer := js.Global.Get("document").Call("createElement", "span")
	spanContainer.Set("innerHTML", markPaliWordInSpan(s))

	// add tooltip to every word
	spans := spanContainer.Call("getElementsByTagName", "span")
	length := spans.Get("length").Int()
	for i := 0; i < length; i++ {
		span := spans.Call("item", i)
		word := strings.ToLower(span.Get("innerHTML").String())
		tooltipContent := word + " " + word + "<br>" + "<span>" + word + "</span>" + " " + word
		tt.AddTooltipToElement(span, tooltipContent)
	}

	return spanContainer
}

// find all words in the element
func traverse(elm *js.Object) {
	// 1: element node
	if elm.Get("nodeType").Int() == 1 {
		childNodesList := elm.Get("childNodes")
		length := childNodesList.Get("length").Int()
		for i := 0; i < length; i++ {
			// // recursively call self to process
			traverse(childNodesList.Call("item", i))
		}
		return
	}

	// 3: text node
	if elm.Get("nodeType").Int() == 3 {
		s := elm.Get("nodeValue").String()
		if strings.TrimSpace(s) != "" {
			// string is not whitespace
			elm.Get("parentNode").Call("replaceChild", toDom(s), elm)
		}
		return
	}
}

// wrap every word in ELEMENT and add tooltip to every word.
func AddTooltipToEveryWord(id string) {
	element := js.Global.Get("document").Call("getElementById", id)
	traverse(element)
}
